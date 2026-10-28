-- 上傳文件的萃取結果：待審、核准與退回（#44，docs/data-model.md「待審與核准」）。
-- 只用 INSERT：核准與退回寫成 review_decisions（每個項目一筆），正式資料表的寫入必須對應到目前身分寫的核准決定。
-- kk_app 仍沒有任何 UPDATE、DELETE。函式以呼叫者權限執行（不使用 SECURITY DEFINER）。

-- 核准權限：由 access.json 的 canReview 匯入
ALTER TABLE kk.identities ADD COLUMN can_review boolean NOT NULL DEFAULT false;

CREATE FUNCTION kk.can_review() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce((SELECT i.can_review FROM kk.identities i WHERE i.id = kk.current_identity_id()), false)
  $$;

-- 讓待審的出處以複合外鍵保證「段落屬於同一份文件」（外鍵檢查不受 RLS 影響，上傳者不必讀取待審資料表）
ALTER TABLE kk.passages ADD CONSTRAINT passages_id_document_key UNIQUE (id, document_id);

CREATE TABLE kk.pending_entities (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES kk.documents (id),
  entity_type text NOT NULL,
  names jsonb NOT NULL CHECK (jsonb_typeof(names) = 'object'),
  UNIQUE (id, document_id)
);

CREATE TABLE kk.pending_entity_sources (
  pending_entity_id text NOT NULL,
  document_id text NOT NULL,
  passage_id text NOT NULL,
  PRIMARY KEY (pending_entity_id, passage_id),
  FOREIGN KEY (pending_entity_id, document_id) REFERENCES kk.pending_entities (id, document_id),
  FOREIGN KEY (passage_id, document_id) REFERENCES kk.passages (id, document_id)
);

CREATE TABLE kk.pending_relations (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES kk.documents (id),
  relation_type text NOT NULL,
  from_pending_id text NOT NULL,
  to_pending_id text NOT NULL,
  UNIQUE (id, document_id),
  -- 兩端是同一份文件的待審實體
  FOREIGN KEY (from_pending_id, document_id) REFERENCES kk.pending_entities (id, document_id),
  FOREIGN KEY (to_pending_id, document_id) REFERENCES kk.pending_entities (id, document_id)
);

CREATE TABLE kk.pending_relation_sources (
  pending_relation_id text NOT NULL,
  document_id text NOT NULL,
  passage_id text NOT NULL,
  PRIMARY KEY (pending_relation_id, passage_id),
  FOREIGN KEY (pending_relation_id, document_id) REFERENCES kk.pending_relations (id, document_id),
  FOREIGN KEY (passage_id, document_id) REFERENCES kk.passages (id, document_id)
);

-- 每個待審項目（實體或關係）最多一筆決定，所以核准或退回只會成功一次
CREATE TABLE kk.review_decisions (
  item_id text PRIMARY KEY,
  decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
  decided_by text NOT NULL REFERENCES kk.identities (id),
  -- 核准前修改的名稱（只用於建立新實體）
  names jsonb CHECK (names IS NULL OR jsonb_typeof(names) = 'object'),
  -- 合併對象（既有實體的 id）
  merge_into text REFERENCES kk.entities (id),
  -- 退回時不帶名稱與合併對象；合併時不帶名稱（既有實體的名稱不變）
  CHECK (decision = 'approve' OR (names IS NULL AND merge_into IS NULL)),
  CHECK (merge_into IS NULL OR names IS NULL)
);

ALTER TABLE kk.pending_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.pending_entity_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.pending_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.pending_relation_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.pending_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.pending_entity_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.pending_relations FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.pending_relation_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.review_decisions FORCE ROW LEVEL SECURITY;

-- 讀取：有 canReview，且文件看得到（同一份上傳文件的段落權限相同，0005 已保證）
CREATE POLICY review ON kk.pending_entities FOR SELECT TO kk_app
  USING (kk.can_review() AND EXISTS (SELECT 1 FROM kk.documents d WHERE d.id = pending_entities.document_id));
CREATE POLICY review ON kk.pending_entity_sources FOR SELECT TO kk_app
  USING (kk.can_review() AND EXISTS (SELECT 1 FROM kk.documents d WHERE d.id = pending_entity_sources.document_id));
CREATE POLICY review ON kk.pending_relations FOR SELECT TO kk_app
  USING (kk.can_review() AND EXISTS (SELECT 1 FROM kk.documents d WHERE d.id = pending_relations.document_id));
CREATE POLICY review ON kk.pending_relation_sources FOR SELECT TO kk_app
  USING (kk.can_review() AND EXISTS (SELECT 1 FROM kk.documents d WHERE d.id = pending_relation_sources.document_id));

-- 寫入待審：有 canUpload，且文件是自己上傳的。同一份文件由外鍵保證；上傳者讀不到待審資料表
CREATE POLICY extract ON kk.pending_entities FOR INSERT TO kk_app
  WITH CHECK (kk.can_upload() AND EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_entities.document_id AND d.uploaded_by = kk.current_identity_id()));
CREATE POLICY extract ON kk.pending_entity_sources FOR INSERT TO kk_app
  WITH CHECK (kk.can_upload() AND EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_entity_sources.document_id AND d.uploaded_by = kk.current_identity_id()));
CREATE POLICY extract ON kk.pending_relations FOR INSERT TO kk_app
  WITH CHECK (kk.can_upload() AND EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_relations.document_id AND d.uploaded_by = kk.current_identity_id()));
CREATE POLICY extract ON kk.pending_relation_sources FOR INSERT TO kk_app
  WITH CHECK (kk.can_upload() AND EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_relation_sources.document_id AND d.uploaded_by = kk.current_identity_id()));

-- 項目是否已核准。review_decisions 自己的 policy 不能直接查詢 review_decisions（PostgreSQL 視為無限遞迴），
-- 所以寫成 PL/pgSQL：不會被內聯進 policy，查詢在執行時才套用 review_decisions 的 SELECT policy（只參照待審資料表）。
-- 以呼叫者權限執行（不使用 SECURITY DEFINER）
CREATE FUNCTION kk.is_approved(p_item_id text) RETURNS boolean
  LANGUAGE plpgsql STABLE
  AS $$
    BEGIN
      RETURN EXISTS (SELECT 1 FROM kk.review_decisions d WHERE d.item_id = p_item_id AND d.decision = 'approve');
    END
  $$;

-- 決定：看得到該項目的核准者才看得到
CREATE POLICY review ON kk.review_decisions FOR SELECT TO kk_app
  USING (kk.can_review() AND (
    EXISTS (SELECT 1 FROM kk.pending_entities p WHERE p.id = review_decisions.item_id)
    OR EXISTS (SELECT 1 FROM kk.pending_relations r WHERE r.id = review_decisions.item_id)));

-- 寫入決定：有 canReview、決定者是自己、項目看得到。
-- 實體：合併對象必須是自己看得到、類型相同的實體。關係：不帶名稱與合併對象；核准時兩端都已核准
CREATE POLICY decide ON kk.review_decisions FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND review_decisions.decided_by = kk.current_identity_id()
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

-- 正式資料表的寫入：必須對應到目前身分寫的核准決定（讀取的 policy 不變）

-- 實體：id、類型與核准的待審實體相同，名稱等於核准時的名稱（決定中的 names，沒有時用待審的 names）；
-- name 必須是 names 的其中一個值
CREATE POLICY approve ON kk.entities FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND EXISTS (
      SELECT 1 FROM kk.review_decisions d JOIN kk.pending_entities p ON p.id = d.item_id
      WHERE d.item_id = entities.id
        AND d.decision = 'approve'
        AND d.merge_into IS NULL
        AND d.decided_by = kk.current_identity_id()
        AND p.entity_type = entities.entity_type
        AND entities.names = coalesce(d.names, p.names)
    )
    AND EXISTS (SELECT 1 FROM jsonb_each_text(entities.names) n WHERE n.value = entities.name)
  );

-- 實體的出處：段落是該待審實體的出處，實體是合併對象或新建的實體
CREATE POLICY approve ON kk.entity_sources FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND EXISTS (
      SELECT 1 FROM kk.review_decisions d JOIN kk.pending_entity_sources s ON s.pending_entity_id = d.item_id
      WHERE d.decision = 'approve'
        AND d.decided_by = kk.current_identity_id()
        AND s.passage_id = entity_sources.passage_id
        AND entity_sources.entity_id = coalesce(d.merge_into, d.item_id)
    )
  );

-- 關係：id、類型與核准的待審關係相同，兩端是兩個待審實體核准後的實體（合併對象或新建的實體）
CREATE POLICY approve ON kk.relations FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND EXISTS (
      SELECT 1
      FROM kk.review_decisions d
      JOIN kk.pending_relations r ON r.id = d.item_id
      JOIN kk.review_decisions f ON f.item_id = r.from_pending_id AND f.decision = 'approve'
      JOIN kk.review_decisions t ON t.item_id = r.to_pending_id AND t.decision = 'approve'
      WHERE d.item_id = relations.id
        AND d.decision = 'approve'
        AND d.decided_by = kk.current_identity_id()
        AND r.relation_type = relations.relation_type
        AND relations.from_entity_id = coalesce(f.merge_into, f.item_id)
        AND relations.to_entity_id = coalesce(t.merge_into, t.item_id)
    )
  );

-- 關係的出處：段落是該待審關係的出處；兩端由 0003 的複合外鍵保證與關係一致
CREATE POLICY approve ON kk.relation_sources FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND EXISTS (
      SELECT 1 FROM kk.review_decisions d JOIN kk.pending_relation_sources s ON s.pending_relation_id = d.item_id
      WHERE d.item_id = relation_sources.relation_id
        AND d.decision = 'approve'
        AND d.decided_by = kk.current_identity_id()
        AND s.passage_id = relation_sources.passage_id
    )
  );

GRANT SELECT, INSERT ON kk.pending_entities, kk.pending_entity_sources, kk.pending_relations, kk.pending_relation_sources,
  kk.review_decisions TO kk_app;
GRANT INSERT ON kk.entities, kk.entity_sources, kk.relations, kk.relation_sources TO kk_app;
