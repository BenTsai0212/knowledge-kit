-- 人的理解（ADR 0012 決定 5、6，#380 PR 3，docs/data-model.md「人的理解」）：
-- 問答中對一組說法不同的兩段留下的解讀。只能新增，不改變事實；kk_app 仍沒有任何 UPDATE、DELETE。不使用 SECURITY DEFINER。

-- 兩段的順序固定（passage_a < passage_b），同一組只有一種寫法；同一個身分對同一組只留一筆。
-- choice 是選的假設的文字（或固定範本的選項），「都不是，我來說明」時是 'other'，只有這時可以附說明（選填）。
-- changed_after_challenge：AI 提出另一種可能後是否改了選擇（ADR 0012 決定 5）
CREATE TABLE kk.interpretations (
  id text PRIMARY KEY CHECK (id LIKE 'in-%'),
  passage_a text NOT NULL REFERENCES kk.passages (id),
  passage_b text NOT NULL REFERENCES kk.passages (id),
  choice text NOT NULL CHECK (char_length(choice) BETWEEN 1 AND 100),
  changed_after_challenge boolean NOT NULL DEFAULT false,
  note text CHECK (note IS NULL OR (choice = 'other' AND char_length(note) BETWEEN 1 AND 500)),
  created_by text NOT NULL REFERENCES kk.identities (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (passage_a < passage_b),
  UNIQUE (created_by, passage_a, passage_b)
);

CREATE INDEX ON kk.interpretations (passage_a, passage_b);

ALTER TABLE kk.interpretations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.interpretations FORCE ROW LEVEL SECURITY;

-- 讀取：兩段都看得到（與 conflict_decisions 相同）。「先作答才看得到同事的理解」由畫面控制（ADR 0012 決定 6）。
-- 只參照 passages，沒有循環
CREATE POLICY can_see ON kk.interpretations FOR SELECT TO kk_app
  USING (
    EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = interpretations.passage_a)
    AND EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = interpretations.passage_b)
  );

-- 寫入：作者是自己、時間是現在、兩段都看得到
CREATE POLICY interpret ON kk.interpretations FOR INSERT TO kk_app
  WITH CHECK (
    interpretations.created_by = kk.current_identity_id()
    AND interpretations.created_at = now()
    AND EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = interpretations.passage_a)
    AND EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = interpretations.passage_b)
  );

GRANT SELECT, INSERT ON kk.interpretations TO kk_app;
