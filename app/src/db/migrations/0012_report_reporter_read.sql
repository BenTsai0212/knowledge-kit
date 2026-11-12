-- 回報結果回到回報的人（#286，ADR 0009，ADR 0007 決定 7 的補充，docs/data-model.md「回答錯誤回報」）。不修改 0010。
-- 1. 處理時選填的「給回報的人的說明」：與處理在同一個 INSERT 寫入；kk_app 沒有 UPDATE，之後不能修改。
--    NULL 表示沒有說明；空字串與超過 500 字由 CHECK 擋掉
ALTER TABLE kk.answer_report_resolutions ADD COLUMN note text CHECK (length(note) BETWEEN 1 AND 500);

-- 2. 回報者讀得到自己的回報：只新增 permissive 的 SELECT policy（own_report），與 0010 的 can_see 以 OR 合併，
--    canReview 的身分看得到的不變。送出的段落仍要目前全部看得到（與 can_see 相同的 unnest 寫法），
--    所以之後段落看不到時一樣讀不到。身分是角色層級，同一角色互相讀得到彼此的回報（ADR 0009 決定 5）。
--    answer_report_resolutions 的 can_see 是「看得到該回報」，因此回報者也讀得到自己回報的處理與說明。
--    寫入（resolve）的 policy 不變，回報者仍不能處理。不使用 SECURITY DEFINER
CREATE POLICY own_report ON kk.answer_reports FOR SELECT TO kk_app
  USING (
    answer_reports.reported_by = kk.current_identity_id()
    AND NOT EXISTS (
      SELECT 1 FROM unnest(answer_reports.sent_passage_ids) AS s (id)
      WHERE NOT EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = s.id))
  );
