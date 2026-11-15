-- 說法不同的假設與證據（ADR 0012 決定 3，#380 PR 2，docs/conflicts.md「假設與證據」）：
-- 比對時每一組多存 2–3 個中立的假設，與原文中最能區分它們的一句話（evidence）及它支持的假設（1 起算）。
-- 不合格時三個欄位都是 NULL，該組退回固定範本；已比對過的舊組合也是 NULL。
-- 欄位在 conflicts 的同一列，跟著 0008 的 RLS（兩段都看得到才讀得到），不需要新的 policy。
-- 「evidence 逐字出現在兩段之一」與「假設去掉前後空白」由 output.ts 檢查。kk_app 仍沒有 UPDATE、DELETE。

ALTER TABLE kk.conflicts
  ADD COLUMN hypotheses text[],
  ADD COLUMN evidence text,
  ADD COLUMN evidence_hypothesis smallint,
  -- 假設：一維、從 1 起算、2–3 個、沒有 NULL、每個 1～30 字、互不相同
  ADD CONSTRAINT conflicts_hypotheses_check CHECK (
    hypotheses IS NULL OR (
      array_ndims(hypotheses) = 1
      AND array_lower(hypotheses, 1) = 1
      AND cardinality(hypotheses) BETWEEN 2 AND 3
      AND array_position(hypotheses, NULL) IS NULL
      AND char_length(hypotheses[1]) BETWEEN 1 AND 30
      AND char_length(hypotheses[2]) BETWEEN 1 AND 30
      AND hypotheses[1] <> hypotheses[2]
      AND (cardinality(hypotheses) = 2 OR (
        char_length(hypotheses[3]) BETWEEN 1 AND 30
        AND hypotheses[3] <> hypotheses[1]
        AND hypotheses[3] <> hypotheses[2]))
    )
  ),
  -- 證據：三個欄位同時有值或同時為 NULL；證據 1～200 字，支持的假設是存在的位置
  ADD CONSTRAINT conflicts_evidence_check CHECK (
    (hypotheses IS NULL AND evidence IS NULL AND evidence_hypothesis IS NULL)
    OR (
      hypotheses IS NOT NULL
      AND evidence IS NOT NULL
      AND evidence_hypothesis IS NOT NULL
      AND char_length(evidence) BETWEEN 1 AND 200
      AND evidence_hypothesis BETWEEN 1 AND cardinality(hypotheses)
    )
  );
