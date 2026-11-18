-- 來源確認（ADR 0013 決定 2～5，#417 PR 2，docs/data-model.md「來源確認」）：
-- 知識負責人確認原文段落，與撤銷確認。只能新增，不修改 kk.passages；kk_app 仍沒有任何 UPDATE、DELETE。不使用 SECURITY DEFINER。

-- action：confirm（確認）或 revoke（撤銷確認）。一段的目前狀態是它看得到的紀錄中 seq 最大的一筆（ADR 0013 決定 2）。
-- 以 seq 而不是 created_at 決定先後：PGlite 的 now() 只到毫秒，連續的交易常常同一時間
CREATE TABLE kk.passage_confirmations (
  id text PRIMARY KEY CHECK (id LIKE 'cf-%'),
  passage_id text NOT NULL REFERENCES kk.passages (id),
  action text NOT NULL CHECK (action IN ('confirm', 'revoke')),
  created_by text NOT NULL REFERENCES kk.identities (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigint GENERATED ALWAYS AS IDENTITY
);

CREATE INDEX ON kk.passage_confirmations (passage_id, seq);

ALTER TABLE kk.passage_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.passage_confirmations FORCE ROW LEVEL SECURITY;

-- 讀取：那一段看得到（比照 interpretations，不看作者）。只參照 passages，沒有循環
CREATE POLICY can_see ON kk.passage_confirmations FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = passage_confirmations.passage_id));

-- 寫入（確認與撤銷同一條規則）：有 canReview、作者是自己、時間是現在、那一段看得到。
-- 不擋「沒確認就撤銷」或「重複確認」：多一筆不影響目前狀態
CREATE POLICY confirm ON kk.passage_confirmations FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND passage_confirmations.created_by = kk.current_identity_id()
    AND passage_confirmations.created_at = now()
    AND EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = passage_confirmations.passage_id)
  );

GRANT SELECT, INSERT ON kk.passage_confirmations TO kk_app;
