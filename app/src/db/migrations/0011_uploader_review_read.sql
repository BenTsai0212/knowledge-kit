-- 上傳者讀得到自己上傳的文件的待審項目與審核決定（#284，ADR 0009，docs/data-model.md「待審與核准」）。
-- 只新增 permissive 的 SELECT policy（own_upload），與 0006 的 review policy 以 OR 合併：canReview 的身分看得到的不變。
-- 「自己」是 documents.uploaded_by = kk.current_identity_id()；子查詢讀 kk.documents 時套用 documents 的 can_see，
-- 所以文件看不到時一樣讀不到。寫入（決定、撤回、正式資料）的 policy 不變，上傳者仍不能核准、退回或撤回。
-- 不使用 SECURITY DEFINER。遞迴只能以測試確認（app/tests/extraction/review.test.ts）

CREATE POLICY own_upload ON kk.pending_entities FOR SELECT TO kk_app
  USING (EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_entities.document_id AND d.uploaded_by = kk.current_identity_id()));
CREATE POLICY own_upload ON kk.pending_entity_sources FOR SELECT TO kk_app
  USING (EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_entity_sources.document_id AND d.uploaded_by = kk.current_identity_id()));
CREATE POLICY own_upload ON kk.pending_relations FOR SELECT TO kk_app
  USING (EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_relations.document_id AND d.uploaded_by = kk.current_identity_id()));
CREATE POLICY own_upload ON kk.pending_relation_sources FOR SELECT TO kk_app
  USING (EXISTS (
    SELECT 1 FROM kk.documents d WHERE d.id = pending_relation_sources.document_id AND d.uploaded_by = kk.current_identity_id()));

-- 實體是否看得到。entities 與 entity_sources 的 INSERT policy（0009）查詢 review_decisions，
-- 若 review_decisions 的 policy 直接查詢 entities，PostgreSQL 在展開 policy 時視為無限遞迴；
-- 所以同 0006 的 kk.is_approved() 寫成 PL/pgSQL：不會被內聯進 policy，查詢在執行時才套用 entities 的 SELECT policy。
-- 以呼叫者權限執行（不使用 SECURITY DEFINER）
CREATE FUNCTION kk.entity_visible(p_entity_id text) RETURNS boolean
  LANGUAGE plpgsql STABLE
  AS $$
    BEGIN
      RETURN EXISTS (SELECT 1 FROM kk.entities e WHERE e.id = p_entity_id);
    END
  $$;

-- 決定：項目屬於自己上傳、看得到的文件，而且合併對象是自己看得到的實體。
-- 合併後再撤回時，舊決定的 merge_into 可能指向上傳者看不到的實體（實體 id 是有意義的代稱，#284 決定 2）
CREATE POLICY own_upload ON kk.review_decisions FOR SELECT TO kk_app
  USING (
    (
      EXISTS (
        SELECT 1 FROM kk.pending_entities p JOIN kk.documents d ON d.id = p.document_id
        WHERE p.id = review_decisions.item_id AND d.uploaded_by = kk.current_identity_id())
      OR EXISTS (
        SELECT 1 FROM kk.pending_relations r JOIN kk.documents d ON d.id = r.document_id
        WHERE r.id = review_decisions.item_id AND d.uploaded_by = kk.current_identity_id())
    )
    AND (review_decisions.merge_into IS NULL OR kk.entity_visible(review_decisions.merge_into))
  );
