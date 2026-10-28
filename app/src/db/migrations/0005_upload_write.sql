-- 上傳的寫入權限（#38，docs/data-model.md「寫入規則」）。kk_app 只新增 INSERT，仍沒有 UPDATE／DELETE。
-- 函式一律以呼叫者權限執行（不使用 SECURITY DEFINER），讀取的資料表同樣受 RLS 限制。

-- 上傳權限：由 access.json 的 canUpload 匯入
ALTER TABLE kk.identities ADD COLUMN can_upload boolean NOT NULL DEFAULT false;

-- 上傳者：資料集的文件為 NULL；段落只能加在自己上傳的文件中
ALTER TABLE kk.documents ADD COLUMN uploaded_by text REFERENCES kk.identities (id);

-- 目前身分能否上傳；identities 的 RLS 只讓身分看到自己，沒有身分時為 false
CREATE FUNCTION kk.can_upload() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce((SELECT i.can_upload FROM kk.identities i WHERE i.id = kk.current_identity_id()), false)
  $$;

-- 文件：能上傳、上傳者是自己，且可見等級與專案是自己看得到的
CREATE POLICY upload ON kk.documents FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_upload()
    AND documents.uploaded_by = kk.current_identity_id()
    AND kk.can_see(documents.visibility_level_id, documents.project_id)
  );

-- 段落：只能加在自己上傳的文件中，可見等級與專案與文件相同
CREATE POLICY upload ON kk.passages FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_upload()
    AND EXISTS (
      SELECT 1 FROM kk.documents d
      WHERE d.id = passages.document_id
        AND d.uploaded_by = kk.current_identity_id()
        AND d.visibility_level_id = passages.visibility_level_id
        AND d.project_id IS NOT DISTINCT FROM passages.project_id
    )
  );

GRANT INSERT ON kk.documents, kk.passages TO kk_app;
