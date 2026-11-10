-- 回答錯誤回報（#209，ADR 0007「資料表與 RLS」0010）。
-- 回報與處理都只能新增；kk_app 仍沒有任何 UPDATE、DELETE。不使用 SECURITY DEFINER。

-- 回報：問題、回答、送給模型的段落（sent）、回答引用的段落（cited，sent 的子集）、回答提到的實體。
-- 段落以陣列存在同一列，不另開子表：子表的 RLS 會隱藏看不到的列，讓「全部看得到」被誤判成立。
-- 拒答時 answer 為 NULL、三個陣列都是空的（只含問題文字）；有回答時一定有送出的段落
CREATE TABLE kk.answer_reports (
  id text PRIMARY KEY CHECK (id LIKE 'ar-%'),
  reported_by text NOT NULL REFERENCES kk.identities (id),
  reported_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL CHECK (category IN ('wrong_fact', 'wrong_citation', 'missing', 'should_refuse', 'should_answer', 'other')),
  note text CHECK (length(note) BETWEEN 1 AND 1000),
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 500),
  answer text CHECK (length(answer) BETWEEN 1 AND 20000),
  sent_passage_ids text[] NOT NULL DEFAULT '{}',
  cited_passage_ids text[] NOT NULL DEFAULT '{}',
  entity_ids text[] NOT NULL DEFAULT '{}',
  CHECK (cited_passage_ids <@ sent_passage_ids),
  CHECK (
    (answer IS NULL AND cardinality(sent_passage_ids) = 0 AND cardinality(cited_passage_ids) = 0 AND cardinality(entity_ids) = 0)
    OR (answer IS NOT NULL AND cardinality(sent_passage_ids) > 0)
  )
);

-- 處理：每個回報一筆（主鍵），所以只會成功一次
CREATE TABLE kk.answer_report_resolutions (
  report_id text PRIMARY KEY REFERENCES kk.answer_reports (id),
  resolution text NOT NULL CHECK (resolution IN ('not_error', 'retracted')),
  resolved_by text NOT NULL REFERENCES kk.identities (id),
  resolved_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kk.answer_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.answer_report_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.answer_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.answer_report_resolutions FORCE ROW LEVEL SECURITY;

-- 讀取回報：有 canReview，而且送出的段落沒有一段看不到（ADR 0007 決定 7，#209 決定 5）。
-- 回答可能用到送出但沒有引用的段落，所以以送出的段落判斷，不只引用的段落。拒答的回報沒有段落，能審核的身分都看得到
CREATE POLICY can_see ON kk.answer_reports FOR SELECT TO kk_app
  USING (
    kk.can_review()
    AND NOT EXISTS (
      SELECT 1 FROM unnest(answer_reports.sent_passage_ids) AS s (id)
      WHERE NOT EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = s.id))
  );

-- 寫入回報：所有身分（#209 決定 3）。回報者是自己、時間是現在，送出的段落與提到的實體自己全部看得到。
-- 沒有 canReview 的回報者讀不到自己寫的回報
CREATE POLICY report ON kk.answer_reports FOR INSERT TO kk_app
  WITH CHECK (
    answer_reports.reported_by = kk.current_identity_id()
    AND answer_reports.reported_at = now()
    AND NOT EXISTS (
      SELECT 1 FROM unnest(answer_reports.sent_passage_ids) AS s (id)
      WHERE NOT EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = s.id))
    AND NOT EXISTS (
      SELECT 1 FROM unnest(answer_reports.entity_ids) AS s (id)
      WHERE NOT EXISTS (SELECT 1 FROM kk.entities e WHERE e.id = s.id))
  );

-- 處理：看得到該回報。參照方向是 answer_report_resolutions → answer_reports → passages，沒有循環
CREATE POLICY can_see ON kk.answer_report_resolutions FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM kk.answer_reports r WHERE r.id = answer_report_resolutions.report_id));

-- 寫入處理：有 canReview、處理者是自己、時間是現在、看得到該回報
CREATE POLICY resolve ON kk.answer_report_resolutions FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND answer_report_resolutions.resolved_by = kk.current_identity_id()
    AND answer_report_resolutions.resolved_at = now()
    AND EXISTS (SELECT 1 FROM kk.answer_reports r WHERE r.id = answer_report_resolutions.report_id)
  );

GRANT SELECT, INSERT ON kk.answer_reports, kk.answer_report_resolutions TO kk_app;
