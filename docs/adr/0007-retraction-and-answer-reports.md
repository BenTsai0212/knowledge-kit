# ADR 0007：使用中修正（撤回核准與回答錯誤回報）

- 狀態：Proposed
- 日期：2026-11-10
- 決定者：@BenTsai0212
- 相關：#209（計畫與 `## 決定`）、#189（系統先判斷、#189 決定 1）、#44（待審與核准）、[docs/data-model.md](../data-model.md)「待審與核准」、[docs/extraction.md](../extraction.md)「限制」

## 背景

正確性的責任目前全部放在核准之前：`kk_app` 只能新增，每個待審項目只能決定一次（`review_decisions` 的主鍵），核准後不能修改或撤回；問答的回答錯了也沒有地方回報。審核者因此每一筆都得事前仔細看，這是「一直要人為 AI 負責」的疲乏來源。研究與業界做法一致指向「錯了能修、能回報」，並以紀錄與評測證明品質，而不是靠逐筆核准（Microsoft 人機互動準則 G9、G15；Google PAIR「Errors + Graceful Failure」；Green 2022；Parasuraman & Manzey 2010）。

限制：實體只要有一個看得到的出處就看得到，同一個實體可能由不同文件、不同人核准。撤回若刪除實體，會影響審核者看不到的文件帶進來的內容。

現況中與撤回衝突的地方（#209 計畫）：

1. `review_decisions` 的主鍵是 `item_id`，每個項目只能有一筆決定，撤回後無法重新決定。
2. `entity_sources`、`relation_sources` 沒有記錄是哪一筆決定寫入的。一般讀者讀不到 `review_decisions` 與待審資料表，讀取的 policy 無法靠關聯待審資料表得出「這個出處已撤回」。
3. 新實體與新關係的 id 等於 `item_id`（0006 的 `approve` policy），撤回後重新核准時會和已撤回的列衝突。

## 選項

- **撤回的單位**
  1. 刪除實體或關係：會影響其他文件的出處與看不到的內容。
  2. 撤回「一個待審項目的決定」：只移除這份文件帶進來的出處（以 W3C PROV 的說法，撤回一次「活動」）。
- **資料的寫法**
  - A. 開放 `UPDATE`／`DELETE`：打破「只能新增」，失去修正紀錄。
  - B. 新增撤回紀錄（只能新增），可見範圍與圖譜改為「已核准、扣掉已撤回」（事件溯源的做法）。
- **誰可以撤回**
  - a. 只有原核准者：人員異動時無法處理。
  - b. 有 `can_review`、且看得到該文件的人。
- **撤回後的項目**：維持「已撤回」不能再決定，或回到待審、可以重新決定。
- **重新核准成新實體時的 id**：`<item_id>~<n>`，或重用原本的 id 並限制名稱不能改。
- **撤回紀錄的可見範圍**：文件看得到就看得到，或只開放給有 `can_review` 的身分。

## 決定

1. **單位與寫法：選項 2＋B。** 撤回的對象是一個待審項目的決定（核准或退回）。新增只能新增的撤回紀錄，不開放 `UPDATE`／`DELETE`。
   - 撤回核准：這份文件經這個決定寫入的出處（`entity_sources`、`relation_sources`）不再算數。實體或關係沒有其他看得到的出處時就看不到；依既有規則，一端看不到的關係也跟著看不到。
   - **連帶撤回以待審關係的端點判斷**（#209 決定 6）：撤回實體時，同一份文件中端點（`from_pending_id`、`to_pending_id`）是這個**待審實體**、已核准且未撤回的關係一併撤回（與「確認（含 N 段關係）」對稱）。不以合併後的實體 id 判斷，避免撤回一個合併時，連帶撤回同一份文件中經其他待審實體連到同一個既有實體的關係。
   - 撤回合併的核准：這份文件的段落不再是既有實體的出處，合併造成的可見範圍擴大隨之收回。
   - 撤回後項目回到待審，可以重新決定；所有決定與撤回都保留，紀錄誰、何時、撤回了什麼。
   - 「圖譜已有的關係」（#189 決定 1）只寫 `review_decisions`、不寫出處，撤回時只有決定回到待審，圖譜不變。
2. **誰：選項 b。** 有 `can_review`、且看得到該文件的身分（同一份文件的段落權限相同，看得到文件就看得到該項目的所有出處，不會越權）。
3. **範圍**：只有經審核進來的內容可以撤回；參考情境與客戶資料集原本的實體與關係沒有決定，所以撤回不了。
4. **核准後幾秒內撤銷**：核准與「核准這份文件的全部」的提示附「撤銷」，撤回剛寫入的決定（全部核准時是那一次寫入的每一筆），以同一套撤回紀錄實作。
5. **重新核准的 id：`<item_id>~<n>`**（#209 決定 1）。第 1 次決定的 id 仍等於 `item_id`，既有資料不變；之後是 `<item_id>~2`、`<item_id>~3`……。新建實體與新建關係的 id 等於決定的 id，不會與已撤回的列衝突。
   - 重新核准走一般的待審流程，包含同名且只有一個候選時的系統建議：原本的實體若因為其他文件的出處仍然存在，會被建議為合併對象，不會出現兩個同名實體。
6. **撤回紀錄的可見範圍：文件看得到就看得到**（#209 決定 2）。一般讀者的出處 policy 要查撤回紀錄；不使用 `SECURITY DEFINER`，以呼叫者權限執行的函式也讀不到 RLS 隱藏的列，所以只開放給 `can_review` 會讓一般讀者的出處 policy 無法運作。看得到文件的人也看得到該文件的撤回紀錄（含撤回者的身分 id），`docs/data-model.md` 註明。
7. **回答錯誤回報**：問答的每個回答可以回報「有錯」（原因類別＋選填說明），記錄問題、回答、送出與引用的段落、回答提到的實體；只能新增，處理狀態也以新增紀錄表示。
   - **誰可以回報**：所有身分（#209 決定 3）。
   - **原因類別**（#209 決定 4）：`wrong_fact`（內容錯）、`wrong_citation`（引用不對）、`missing`（漏了資訊）、`should_refuse`（應該拒答）、`should_answer`（拒答了，但資料中有答案）、`other`。拒答的回報預設選 `should_answer`。
   - **可見範圍以送給模型的所有段落判斷，不只引用的段落**（#209 決定 5）：回答可能用到送出但沒有引用的段落內容。有 `can_review`、且**送出的段落全部看得到**時才看得到該回報。
   - **拒答的回報只含問題文字**：不記錄回答與段落，所有能審核的身分都看得到。
   - 從回報可以打開原文與實體，並在那裡撤回；或標示「不是錯誤」。
   - **補充（#286，[ADR 0009](0009-writers-read-own-writes.md)，migration 0012）**：回報者也讀得到自己的回報與處理結果（含處理時選填的「給回報的人的說明」），送出的段落仍要**目前**全部看得到。身分是角色層級，同一角色互相讀得到彼此的回報，仍受送出段落可見性限制。回報者仍不能處理。
8. **分級**：合併（會擴大可見範圍）仍維持事前審核；「有把握的直接收錄」（#189 的 B 方案）不在本 ADR，另寫 ADR。

## 資料表與 RLS

新的 migration，不修改 0001–0008。policy 一律以呼叫者權限執行，不使用 `SECURITY DEFINER`；`kk_app` 仍然沒有任何 `UPDATE`、`DELETE`。

### 0009：撤回

- **`review_decisions`**：新增 `id text` 與 `round int`。既有列回填 `id = item_id`、`round = 1`。主鍵改成 `id`，加上 `UNIQUE (item_id, round)` 與 CHECK（`round = 1` 時 `id = item_id`，否則 `id = item_id || '~' || round`）。
  - INSERT policy 另外要求：同一項目先前的決定都已撤回，且 `round` 等於先前的筆數加一；同時寫入由唯一鍵擋掉。policy 直接查詢自己的資料表會被視為無限遞迴，所以「下一個 round」寫成 PL/pgSQL 函式（比照 `kk.is_approved()`）。
- **`review_retractions`**（只能新增）：`decision_id`（主鍵，參照 `review_decisions.id`，所以每個決定只能撤回一次）、`document_id`、`retracted_by`、`retracted_at`、`cascade_of`（連帶撤回時指向實體的撤回，否則 NULL）。
  - SELECT：`document_id` 的文件看得到即可，不要求 `can_review`（決定 6）。看得到出處段落就看得到文件，所以不會擴大可見範圍。
  - INSERT：有 `can_review`、`retracted_by` 是自己、決定的項目看得到且屬於 `document_id` 的文件。
  - 連帶撤回由 `store.ts` 在同一個交易中寫入；INSERT policy 不強制連帶撤回。只撤回實體時，依既有規則一端看不到的關係也看不到，另以測試確認。
- **`entity_sources`、`relation_sources`**：新增可為空的 `decision_id`（參照 `review_decisions.id`；參考情境與資料集為 NULL）。既有核准的出處依 `review_decisions` 回填。主鍵改為 `UNIQUE NULLS NOT DISTINCT (entity_id, passage_id, decision_id)`（關係同理），讓撤回後重新合併到同一個實體時不會撞鍵。
  - SELECT policy 改成：段落看得到，而且「`decision_id` 為 NULL」或「沒有它的撤回紀錄」。實體與關係的可見規則（0002、0003）沿用既有寫法，不另加規則。
  - INSERT（`approve` policy）：出處的 `decision_id` 必須是目前身分寫的、未撤回的核准。
- **`kk.is_approved()`** 改成判斷「有效且未撤回的核准」。新建實體與關係的 id 用決定的 `id`；關係的兩端用「兩端目前有效的核准」的 `coalesce(merge_into, id)`。0006 中的 `decide` 與四個 `approve` policy 先 DROP 再 CREATE。
- 待審頁的「待審」改為「沒有有效的決定」（沒有決定，或所有決定都已撤回）。

### 0010：回答錯誤回報

- **`answer_reports`**（只能新增）：`id`、`reported_by`、`reported_at`、`category`（決定 7 的 6 類，CHECK）、`note`（選填）、`question`、`answer`（拒答時 NULL）、`sent_passage_ids text[]`、`cited_passage_ids text[]`、`entity_ids text[]`。
  - CHECK：`cited_passage_ids <@ sent_passage_ids`；`answer` 為 NULL 時三個陣列都是空的。
  - 段落以陣列存在同一列，不另開子表：子表的 RLS 會隱藏看不到的列，讓「全部看得到」被誤判成立。
  - SELECT：有 `can_review`，而且 `sent_passage_ids` 中沒有看不到的段落。
  - INSERT：`reported_by` 是自己，且 `sent_passage_ids` 自己全部看得到。
- **`answer_report_resolutions`**（只能新增）：`report_id`、`resolution`（`not_error`、`retracted`）、`resolved_by`、`resolved_at`。
  - SELECT：看得到該回報。INSERT：有 `can_review`、`resolved_by` 是自己、看得到該回報。
- **0012 的補充**（#286，不修改 0010）：`answer_report_resolutions` 新增 `note`（給回報的人的說明，選填，1～500 字，與處理同時寫入、之後不能修改）；`answer_reports` 新增 permissive 的 SELECT policy `own_report`（`reported_by` 是自己，且送出的段落全部看得到），與 `can_see` 以 OR 合併。

## 後果

- **好處**：審錯能救回，事前審核的壓力降低；修正有完整紀錄，可以向客戶說明「誰在何時根據什麼改了什麼」；可見範圍的連帶效果沿用既有 RLS，不另寫規則；為之後放寬事前審核鋪路。
- **代價**：
  - 每個讀取出處的 policy 都要排除已撤回的出處，RLS 與 `oracle.ts` 變複雜；滲漏矩陣要加入撤回的情境（撤回後看不到、其他文件的出處不受影響、看不到文件的人不能撤回、合併撤回後可見範圍收回）。
  - 回報表新增一條「送出的段落全部看得到」的可見規則與測試（含「沒有引用、但送出的段落看不到時，看不到該回報」）。
  - 看得到文件的人也看得到該文件的撤回紀錄與撤回者的身分 id。
- **限制**：線上 demo 與本機都使用瀏覽器的記憶體資料庫，撤回與回報重新整理即消失；不能修改已核准的名稱、不能拆開合併錯的實體。
- **後續工作**（#209，依序各一個 PR）：
  1. 本 ADR。
  2. 0009、`store.ts` 的撤回與待審判斷、`oracle.ts` 與滲漏矩陣、RLS 測試。
  3. 撤回的畫面（提示的「撤銷」、圖譜面板的撤回）、`docs/data-model.md`、`docs/extraction.md`、E2E。
  4. 0010、回報的 store、RLS 測試。
  5. 回報的畫面（問答的「回報有錯」、待審頁的「回報」）、`docs/qa.md`、`docs/client-config.md`、E2E。
- **之後另開 Issue**：修改已核准的名稱；拆開合併錯的實體；有把握直接收錄（新 ADR）；給客戶的品質報告引用回報與撤回的統計。
