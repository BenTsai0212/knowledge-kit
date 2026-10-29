-- 上傳文件與既有段落說法不同之處：偵測結果與主管的決定（#51，docs/data-model.md「說法不同」）。
-- 只用 INSERT：偵測結果寫成 conflicts，決定寫成 conflict_decisions（每組一筆）；「取代」不修改、不隱藏舊段落。
-- kk_app 仍沒有任何 UPDATE、DELETE。不使用 SECURITY DEFINER。

-- 偵測結果：新文件（上傳的文件）的一段 對 既有的一段
CREATE TABLE kk.conflicts (
  id text PRIMARY KEY CHECK (id LIKE 'pc-%'),
  document_id text NOT NULL,
  new_passage_id text NOT NULL,
  old_passage_id text NOT NULL REFERENCES kk.passages (id),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 200),
  -- 新段落屬於新文件（0006 的複合鍵）
  FOREIGN KEY (new_passage_id, document_id) REFERENCES kk.passages (id, document_id),
  CHECK (new_passage_id <> old_passage_id),
  UNIQUE (new_passage_id, old_passage_id),
  -- 讓決定以複合外鍵帶上兩段的 id
  UNIQUE (id, new_passage_id, old_passage_id)
);

-- 主管的決定：每組最多一筆，所以只會成功一次。
-- 帶上兩段的 id（由複合外鍵保證與 conflicts 一致），讓 SELECT policy 不必參照 conflicts，避免 policy 互相參照
CREATE TABLE kk.conflict_decisions (
  conflict_id text PRIMARY KEY,
  new_passage_id text NOT NULL,
  old_passage_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('coexist', 'supersede', 'not_conflict')),
  decided_by text NOT NULL REFERENCES kk.identities (id),
  FOREIGN KEY (conflict_id, new_passage_id, old_passage_id) REFERENCES kk.conflicts (id, new_passage_id, old_passage_id)
);

CREATE INDEX ON kk.conflicts (document_id);
CREATE INDEX ON kk.conflicts (old_passage_id);

ALTER TABLE kk.conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.conflict_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.conflicts FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.conflict_decisions FORCE ROW LEVEL SECURITY;

-- 決定：兩段都看得到，且（有 canReview，或決定是「並存」「取代」）。只參照 passages
CREATE POLICY can_see ON kk.conflict_decisions FOR SELECT TO kk_app
  USING (
    EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = conflict_decisions.new_passage_id)
    AND EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = conflict_decisions.old_passage_id)
    AND (kk.can_review() OR conflict_decisions.decision IN ('coexist', 'supersede'))
  );

-- 偵測結果：兩段都看得到，且（有 canReview，或已決定為「並存」「取代」）。
-- 參照方向是 conflicts → conflict_decisions → passages，沒有循環
CREATE POLICY can_see ON kk.conflicts FOR SELECT TO kk_app
  USING (
    EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = conflicts.new_passage_id)
    AND EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = conflicts.old_passage_id)
    AND (
      kk.can_review()
      OR EXISTS (
        SELECT 1 FROM kk.conflict_decisions d
        WHERE d.conflict_id = conflicts.id AND d.decision IN ('coexist', 'supersede'))
    )
  );

-- 寫入偵測結果：有 canUpload，新文件是自己上傳的（新段落屬於新文件由外鍵保證），
-- 既有段落自己看得到，且不在新文件中。上傳者沒有 canReview 時讀不到自己寫的紀錄
CREATE POLICY detect ON kk.conflicts FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_upload()
    AND EXISTS (
      SELECT 1 FROM kk.documents d WHERE d.id = conflicts.document_id AND d.uploaded_by = kk.current_identity_id())
    AND EXISTS (
      SELECT 1 FROM kk.passages p WHERE p.id = conflicts.old_passage_id AND p.document_id <> conflicts.document_id)
  );

-- 寫入決定：有 canReview、決定者是自己、該組對自己可見。
-- 有 canReview 時「該組可見」等於「兩段都看得到」，兩段由複合外鍵保證與該組一致，所以直接檢查兩段。
-- 不寫成 EXISTS (SELECT … FROM kk.conflicts)：conflicts 的 SELECT policy 參照 conflict_decisions，PostgreSQL 會報 infinite recursion
CREATE POLICY decide ON kk.conflict_decisions FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND conflict_decisions.decided_by = kk.current_identity_id()
    AND EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = conflict_decisions.new_passage_id)
    AND EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = conflict_decisions.old_passage_id)
  );

GRANT SELECT, INSERT ON kk.conflicts, kk.conflict_decisions TO kk_app;
