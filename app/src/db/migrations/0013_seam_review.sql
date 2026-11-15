-- 只審接縫：有把握的項目由上傳者直接收錄（ADR 0011 決定 4，#378 PR 2a，docs/data-model.md「直接收錄」）。
-- 上傳者寫入 mode = 'auto' 的核准決定，再依該決定寫入正式資料。資料庫檢查的部分：項目屬於自己上傳、看得到的文件，
-- 沒有 unsure，名稱沒有空白，合併對象看得到且類型相同，關係兩端都已核准。合併候選數、編輯距離與名稱涵蓋所有語言
-- 由 store.ts 在同一個交易中重算（#378 決定 1）。
-- 只新增欄位與 permissive 的 INSERT policy；0009 的 decide 改成只接受 manual。kk_app 仍沒有 UPDATE、DELETE；不使用 SECURITY DEFINER。

-- 決定：manual 是人做的決定（現行），auto 是直接收錄。note 是人寫的說明（「都不是，我來說明」，ADR 0011 決定 6）
ALTER TABLE kk.review_decisions
  ADD COLUMN mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'auto')),
  ADD COLUMN note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  -- 直接收錄只核准，不修改名稱、不帶說明
  ADD CONSTRAINT review_decisions_auto_check CHECK (mode = 'manual' OR (decision = 'approve' AND names IS NULL AND note IS NULL));

-- 撤回的理由：名稱錯了、關係用錯了、不該合併、不該收錄、其他（ADR 0011 決定 5，#378 決定 4）。
-- 既有的撤回與連帶撤回為 NULL
ALTER TABLE kk.review_retractions
  ADD COLUMN reason text CHECK (reason IS NULL OR reason IN ('name', 'relation', 'merge', 'exclude', 'other'));

-- 模型標示沒把握的原因（ADR 0011 決定 1）。萃取在 PR 3 才寫入；寫入跟著 0006 的 extract policy
ALTER TABLE kk.pending_entities
  ADD COLUMN unsure text CHECK (unsure IS NULL OR unsure IN ('same_name', 'possible_typo', 'relation_wording', 'other'));
ALTER TABLE kk.pending_relations
  ADD COLUMN unsure text CHECK (unsure IS NULL OR unsure IN ('same_name', 'possible_typo', 'relation_wording', 'other'));

-- 人做的決定：0009 的條件，加上 mode = 'manual'（沒有 canReview 的上傳者不能用 manual 繞過）
DROP POLICY decide ON kk.review_decisions;
CREATE POLICY decide ON kk.review_decisions FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND review_decisions.mode = 'manual'
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

-- 直接收錄的決定：有 canUpload、決定者是自己、項目屬於自己上傳且看得到的文件（documents 的 can_see）、round 是下一筆。
-- 實體：沒有 unsure、名稱至少一個而且沒有空白，合併對象是自己看得到、類型相同的實體。
-- 關係：沒有 unsure、不帶合併對象，兩端都已核准（人或直接收錄）
CREATE POLICY auto ON kk.review_decisions FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_upload()
    AND review_decisions.mode = 'auto'
    AND review_decisions.decided_by = kk.current_identity_id()
    AND review_decisions.round = kk.next_round(review_decisions.item_id)
    AND (
      EXISTS (
        SELECT 1 FROM kk.pending_entities p JOIN kk.documents d ON d.id = p.document_id
        WHERE p.id = review_decisions.item_id
          AND d.uploaded_by = kk.current_identity_id()
          AND p.unsure IS NULL
          AND p.names <> '{}'::jsonb
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_each(p.names) n WHERE jsonb_typeof(n.value) <> 'string' OR btrim(n.value #>> '{}') = '')
          AND (review_decisions.merge_into IS NULL OR EXISTS (
            SELECT 1 FROM kk.entities e WHERE e.id = review_decisions.merge_into AND e.entity_type = p.entity_type))
      )
      OR EXISTS (
        SELECT 1 FROM kk.pending_relations r JOIN kk.documents d ON d.id = r.document_id
        WHERE r.id = review_decisions.item_id
          AND d.uploaded_by = kk.current_identity_id()
          AND r.unsure IS NULL
          AND review_decisions.merge_into IS NULL
          AND kk.is_approved(r.from_pending_id)
          AND kk.is_approved(r.to_pending_id)
      )
    )
  );

-- 正式資料表的寫入：0009 的 approve 條件，把 can_review() 換成「決定是自己寫的 auto 決定」。
-- 與 approve 以 OR 合併；auto 決定本身已限定上傳者與非接縫項目

CREATE POLICY auto ON kk.entities FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM kk.review_decisions d JOIN kk.pending_entities p ON p.id = d.item_id
      WHERE d.id = entities.id
        AND d.mode = 'auto'
        AND d.decision = 'approve'
        AND d.merge_into IS NULL
        AND d.decided_by = kk.current_identity_id()
        AND NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = d.id)
        AND p.entity_type = entities.entity_type
        AND entities.names = p.names
    )
    AND EXISTS (SELECT 1 FROM jsonb_each_text(entities.names) n WHERE n.value = entities.name)
  );

CREATE POLICY auto ON kk.entity_sources FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM kk.review_decisions d JOIN kk.pending_entity_sources s ON s.pending_entity_id = d.item_id
      WHERE d.id = entity_sources.decision_id
        AND d.mode = 'auto'
        AND d.decision = 'approve'
        AND d.decided_by = kk.current_identity_id()
        AND NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = d.id)
        AND s.passage_id = entity_sources.passage_id
        AND entity_sources.entity_id = coalesce(d.merge_into, d.id)
    )
  );

CREATE POLICY auto ON kk.relations FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM kk.review_decisions d
      JOIN kk.pending_relations r ON r.id = d.item_id
      JOIN kk.review_decisions f ON f.item_id = r.from_pending_id AND f.decision = 'approve'
      JOIN kk.review_decisions t ON t.item_id = r.to_pending_id AND t.decision = 'approve'
      WHERE d.id = relations.id
        AND d.mode = 'auto'
        AND d.decision = 'approve'
        AND d.decided_by = kk.current_identity_id()
        AND NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id IN (d.id, f.id, t.id))
        AND r.relation_type = relations.relation_type
        AND relations.from_entity_id = coalesce(f.merge_into, f.id)
        AND relations.to_entity_id = coalesce(t.merge_into, t.id)
    )
  );

CREATE POLICY auto ON kk.relation_sources FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM kk.review_decisions d JOIN kk.pending_relation_sources s ON s.pending_relation_id = d.item_id
      WHERE d.id = relation_sources.decision_id
        AND d.id = relation_sources.relation_id
        AND d.mode = 'auto'
        AND d.decision = 'approve'
        AND d.decided_by = kk.current_identity_id()
        AND NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = d.id)
        AND s.passage_id = relation_sources.passage_id
    )
  );
