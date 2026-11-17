-- 後面批次的「沒把握」標示（#404，ADR 0011 決定 1，docs/extraction.md「去重」）。
-- 一份文件分成多批萃取時，後面的批次沿用前面寫入的待審項目，只補上出處；待審只能新增，所以後面批次的 unsure
-- 寫成這兩張只能新增的資料表（比照 pending_*_sources）。每個項目最多一列，寫入用 ON CONFLICT DO NOTHING：第一個寫入的原因保留。
-- 有效的標示是 coalesce(pending_*.unsure, 這裡的 unsure)：pending_*.unsure 是第一次寫入的批次，一定比這裡早。
-- kk_app 只有 SELECT、INSERT；不使用 SECURITY DEFINER。另重建 review_decisions 的 auto policy：這裡有列的項目不能直接收錄

CREATE TABLE kk.pending_entity_unsure (
  pending_entity_id text PRIMARY KEY,
  document_id text NOT NULL,
  unsure text NOT NULL CHECK (unsure IN ('same_name', 'possible_typo', 'relation_wording', 'other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pending_entity_id, document_id) REFERENCES kk.pending_entities (id, document_id)
);

CREATE TABLE kk.pending_relation_unsure (
  pending_relation_id text PRIMARY KEY,
  document_id text NOT NULL,
  unsure text NOT NULL CHECK (unsure IN ('same_name', 'possible_typo', 'relation_wording', 'other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pending_relation_id, document_id) REFERENCES kk.pending_relations (id, document_id)
);

ALTER TABLE kk.pending_entity_unsure ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.pending_relation_unsure ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.pending_entity_unsure FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.pending_relation_unsure FORCE ROW LEVEL SECURITY;

-- 讀取：比照 0006 的 review（有 canReview，且文件看得到）與 0011 的 own_upload（自己上傳、看得到的文件）
CREATE POLICY review ON kk.pending_entity_unsure FOR SELECT TO kk_app
  USING (kk.can_review() AND EXISTS (SELECT 1 FROM kk.documents d WHERE d.id = pending_entity_unsure.document_id));
CREATE POLICY review ON kk.pending_relation_unsure FOR SELECT TO kk_app
  USING (kk.can_review() AND EXISTS (SELECT 1 FROM kk.documents d WHERE d.id = pending_relation_unsure.document_id));
CREATE POLICY own_upload ON kk.pending_entity_unsure FOR SELECT TO kk_app
  USING (EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_entity_unsure.document_id AND d.uploaded_by = kk.current_identity_id()));
CREATE POLICY own_upload ON kk.pending_relation_unsure FOR SELECT TO kk_app
  USING (EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_relation_unsure.document_id AND d.uploaded_by = kk.current_identity_id()));

-- 寫入：比照 0006 的 extract（有 canUpload，且文件是自己上傳的）。項目屬於同一份文件由外鍵保證
CREATE POLICY extract ON kk.pending_entity_unsure FOR INSERT TO kk_app
  WITH CHECK (kk.can_upload() AND EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_entity_unsure.document_id AND d.uploaded_by = kk.current_identity_id()));
CREATE POLICY extract ON kk.pending_relation_unsure FOR INSERT TO kk_app
  WITH CHECK (kk.can_upload() AND EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_relation_unsure.document_id AND d.uploaded_by = kk.current_identity_id()));

GRANT SELECT, INSERT ON kk.pending_entity_unsure, kk.pending_relation_unsure TO kk_app;

-- 直接收錄的決定：0013 的條件，加上「後面批次沒有標示沒把握」。
-- 上傳者以 own_upload 讀得到自己文件的標示，所以 NOT EXISTS 看得到全部的列
DROP POLICY auto ON kk.review_decisions;
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
          AND NOT EXISTS (SELECT 1 FROM kk.pending_entity_unsure u WHERE u.pending_entity_id = p.id)
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
          AND NOT EXISTS (SELECT 1 FROM kk.pending_relation_unsure u WHERE u.pending_relation_id = r.id)
          AND review_decisions.merge_into IS NULL
          AND kk.is_approved(r.from_pending_id)
          AND kk.is_approved(r.to_pending_id)
      )
    )
  );
