-- 撤回核准與退回（#209，ADR 0007「資料表與 RLS」0009）。
-- 撤回寫成 review_retractions（每個決定最多一筆）；撤回後項目回到待審，可以再決定一次（round 加一）。
-- 正式資料的出處帶上寫入它的決定，讀取時扣掉已撤回的決定。kk_app 仍沒有任何 UPDATE、DELETE；不使用 SECURITY DEFINER。

-- 決定：同一個項目可以有多筆（每次撤回後一筆）。id 第 1 次等於 item_id（既有資料不變），之後是 <item_id>~<round>。
-- 新建的實體與關係以決定的 id 為 id，重新核准時不會與已撤回的列衝突
ALTER TABLE kk.review_decisions
  ADD COLUMN round integer NOT NULL DEFAULT 1 CHECK (round >= 1),
  ADD COLUMN id text GENERATED ALWAYS AS (CASE WHEN round = 1 THEN item_id ELSE item_id || '~' || round::text END) STORED;
ALTER TABLE kk.review_decisions
  DROP CONSTRAINT review_decisions_pkey,
  ADD PRIMARY KEY (id),
  ADD CONSTRAINT review_decisions_item_round_key UNIQUE (item_id, round);

-- 撤回：每個決定最多一筆。document_id 是該項目所屬的文件（INSERT policy 檢查），讓 SELECT policy 只參照 documents
CREATE TABLE kk.review_retractions (
  decision_id text PRIMARY KEY REFERENCES kk.review_decisions (id),
  document_id text NOT NULL REFERENCES kk.documents (id),
  retracted_by text NOT NULL REFERENCES kk.identities (id),
  retracted_at timestamptz NOT NULL DEFAULT now(),
  -- 撤回實體時一併撤回的關係：指向實體的撤回
  cascade_of text REFERENCES kk.review_retractions (decision_id)
);

CREATE INDEX ON kk.review_retractions (document_id);

-- 出處：寫入它的決定（參考情境與資料集為 NULL，所以撤回不了）。
-- 同一段落可以由不同的決定各寫一筆（例如撤回合併後再合併一次），各自撤回
ALTER TABLE kk.entity_sources ADD COLUMN decision_id text REFERENCES kk.review_decisions (id);
ALTER TABLE kk.relation_sources ADD COLUMN decision_id text REFERENCES kk.review_decisions (id);

-- 既有核准的出處依決定回填（寫法同 0003；資料庫在載入時從 migration 重建，執行時還沒有資料列）
UPDATE kk.entity_sources
SET decision_id = d.id
FROM kk.review_decisions d JOIN kk.pending_entity_sources s ON s.pending_entity_id = d.item_id
WHERE d.decision = 'approve' AND s.passage_id = entity_sources.passage_id AND entity_sources.entity_id = coalesce(d.merge_into, d.item_id);
UPDATE kk.relation_sources
SET decision_id = d.id
FROM kk.review_decisions d JOIN kk.pending_relation_sources s ON s.pending_relation_id = d.item_id
WHERE d.decision = 'approve' AND s.passage_id = relation_sources.passage_id AND relation_sources.relation_id = d.item_id;

ALTER TABLE kk.entity_sources
  DROP CONSTRAINT entity_sources_pkey,
  ADD CONSTRAINT entity_sources_entity_passage_decision_key UNIQUE NULLS NOT DISTINCT (entity_id, passage_id, decision_id);
ALTER TABLE kk.relation_sources
  DROP CONSTRAINT relation_sources_pkey,
  ADD CONSTRAINT relation_sources_relation_passage_decision_key UNIQUE NULLS NOT DISTINCT (relation_id, passage_id, decision_id);

ALTER TABLE kk.review_retractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.review_retractions FORCE ROW LEVEL SECURITY;

-- 讀取撤回：文件看得到即可，不要求 canReview（ADR 0007 決定 6）。一般讀者的出處 policy 要查這張表；
-- 看得到出處段落就看得到所屬文件，所以出處的撤回一定讀得到
CREATE POLICY can_see ON kk.review_retractions FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM kk.documents d WHERE d.id = review_retractions.document_id));

-- 寫入撤回：有 canReview、撤回者是自己、時間是現在，決定看得到（項目看得到）且項目屬於 document_id 的文件。
-- 連帶撤回由 store.ts 在同一個交易中寫入，這裡不強制
CREATE POLICY retract ON kk.review_retractions FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND review_retractions.retracted_by = kk.current_identity_id()
    AND review_retractions.retracted_at = now()
    AND EXISTS (
      SELECT 1 FROM kk.review_decisions d
      WHERE d.id = review_retractions.decision_id
        AND (
          EXISTS (SELECT 1 FROM kk.pending_entities p WHERE p.id = d.item_id AND p.document_id = review_retractions.document_id)
          OR EXISTS (SELECT 1 FROM kk.pending_relations p WHERE p.id = d.item_id AND p.document_id = review_retractions.document_id)
        )
    )
  );

-- 出處：出處段落看得到，而且不是已撤回的決定寫入的
DROP POLICY can_see ON kk.entity_sources;
CREATE POLICY can_see ON kk.entity_sources FOR SELECT TO kk_app
  USING (
    EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = entity_sources.passage_id)
    AND (
      entity_sources.decision_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = entity_sources.decision_id)
    )
  );

DROP POLICY can_see ON kk.relation_sources;
CREATE POLICY can_see ON kk.relation_sources FOR SELECT TO kk_app
  USING (
    EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = relation_sources.passage_id)
    AND EXISTS (SELECT 1 FROM kk.entities e WHERE e.id = relation_sources.from_entity_id)
    AND EXISTS (SELECT 1 FROM kk.entities e WHERE e.id = relation_sources.to_entity_id)
    AND (
      relation_sources.decision_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = relation_sources.decision_id)
    )
  );

-- 項目是否有有效（未撤回）的核准。寫成 PL/pgSQL 的理由同 0006
CREATE OR REPLACE FUNCTION kk.is_approved(p_item_id text) RETURNS boolean
  LANGUAGE plpgsql STABLE
  AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM kk.review_decisions d
        WHERE d.item_id = p_item_id AND d.decision = 'approve'
          AND NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = d.id));
    END
  $$;

-- 下一筆決定的 round：先前的決定都已撤回時是筆數加一，還有有效的決定時是 NULL。
-- review_decisions 的 policy 不能直接查詢自己（無限遞迴），所以同樣寫成 PL/pgSQL；以呼叫者權限執行
CREATE FUNCTION kk.next_round(p_item_id text) RETURNS integer
  LANGUAGE plpgsql STABLE
  AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM kk.review_decisions d
        WHERE d.item_id = p_item_id
          AND NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = d.id)) THEN
        RETURN NULL;
      END IF;
      RETURN (SELECT count(*) + 1 FROM kk.review_decisions d WHERE d.item_id = p_item_id);
    END
  $$;

-- 寫入決定：0006 的條件，加上 round 必須是下一筆（同時寫入由 UNIQUE (item_id, round) 擋掉）
DROP POLICY decide ON kk.review_decisions;
CREATE POLICY decide ON kk.review_decisions FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND review_decisions.decided_by = kk.current_identity_id()
    AND review_decisions.round = kk.next_round(review_decisions.item_id)
    AND (
      EXISTS (
        SELECT 1 FROM kk.pending_entities p
        WHERE p.id = review_decisions.item_id
          AND (review_decisions.merge_into IS NULL OR EXISTS (
            SELECT 1 FROM kk.entities e WHERE e.id = review_decisions.merge_into AND e.entity_type = p.entity_type))
      )
      OR EXISTS (
        SELECT 1 FROM kk.pending_relations r
        WHERE r.id = review_decisions.item_id
          AND review_decisions.names IS NULL
          AND review_decisions.merge_into IS NULL
          AND (review_decisions.decision = 'reject' OR (kk.is_approved(r.from_pending_id) AND kk.is_approved(r.to_pending_id)))
      )
    )
  );

-- 正式資料表的寫入：必須對應到目前身分寫的、未撤回的核准決定（0006 的條件，id 改用決定的 id）

DROP POLICY approve ON kk.entities;
CREATE POLICY approve ON kk.entities FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND EXISTS (
      SELECT 1 FROM kk.review_decisions d JOIN kk.pending_entities p ON p.id = d.item_id
      WHERE d.id = entities.id
        AND d.decision = 'approve'
        AND d.merge_into IS NULL
        AND d.decided_by = kk.current_identity_id()
        AND NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = d.id)
        AND p.entity_type = entities.entity_type
        AND entities.names = coalesce(d.names, p.names)
    )
    AND EXISTS (SELECT 1 FROM jsonb_each_text(entities.names) n WHERE n.value = entities.name)
  );

-- 實體的出處：段落是該待審實體的出處，實體是合併對象或新建的實體，decision_id 是這個決定
DROP POLICY approve ON kk.entity_sources;
CREATE POLICY approve ON kk.entity_sources FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND EXISTS (
      SELECT 1 FROM kk.review_decisions d JOIN kk.pending_entity_sources s ON s.pending_entity_id = d.item_id
      WHERE d.id = entity_sources.decision_id
        AND d.decision = 'approve'
        AND d.decided_by = kk.current_identity_id()
        AND NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = d.id)
        AND s.passage_id = entity_sources.passage_id
        AND entity_sources.entity_id = coalesce(d.merge_into, d.id)
    )
  );

-- 關係：兩端是兩個待審實體目前有效的核准所對應的實體（合併對象或新建的實體）
DROP POLICY approve ON kk.relations;
CREATE POLICY approve ON kk.relations FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND EXISTS (
      SELECT 1
      FROM kk.review_decisions d
      JOIN kk.pending_relations r ON r.id = d.item_id
      JOIN kk.review_decisions f ON f.item_id = r.from_pending_id AND f.decision = 'approve'
      JOIN kk.review_decisions t ON t.item_id = r.to_pending_id AND t.decision = 'approve'
      WHERE d.id = relations.id
        AND d.decision = 'approve'
        AND d.decided_by = kk.current_identity_id()
        AND NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id IN (d.id, f.id, t.id))
        AND r.relation_type = relations.relation_type
        AND relations.from_entity_id = coalesce(f.merge_into, f.id)
        AND relations.to_entity_id = coalesce(t.merge_into, t.id)
    )
  );

-- 關係的出處：段落是該待審關係的出處，關係與 decision_id 都是這個決定；兩端由 0003 的複合外鍵保證與關係一致
DROP POLICY approve ON kk.relation_sources;
CREATE POLICY approve ON kk.relation_sources FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND EXISTS (
      SELECT 1 FROM kk.review_decisions d JOIN kk.pending_relation_sources s ON s.pending_relation_id = d.item_id
      WHERE d.id = relation_sources.decision_id
        AND d.id = relation_sources.relation_id
        AND d.decision = 'approve'
        AND d.decided_by = kk.current_identity_id()
        AND NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = d.id)
        AND s.passage_id = relation_sources.passage_id
    )
  );

GRANT SELECT, INSERT ON kk.review_retractions TO kk_app;
