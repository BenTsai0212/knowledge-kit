-- 文件日期（時間軸）與實體依語言區分的顯示名稱（#31）。
-- 兩者都是既有資料表的欄位，跟著所在列的 RLS，不需要新的 policy。

-- 選填：資料集的 date 可以省略。讀取時在 SQL 中轉成 'YYYY-MM-DD'，不經過 JavaScript 的 Date（避免時區影響）
ALTER TABLE kk.documents ADD COLUMN document_date date;

-- 例如 {"zh-TW": "王小明", "en": "Ming Wang"}；涵蓋所有 languages 由寫入的程式檢查（docs/data-model.md）
ALTER TABLE kk.entities
  ADD COLUMN names jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT entities_names_object CHECK (jsonb_typeof(names) = 'object');
