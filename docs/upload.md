# 上傳文件（`app/src/upload/`）

讓使用者上傳文件，切成段落寫入資料庫，依上傳時設定的可見等級與專案**立即**可被問答、時間軸與原文查到。決策紀錄見 #38；萃取實體與關係（9b）、說法不同的並列（9c）不在本功能。

> 上傳內容只存在瀏覽器的記憶體資料庫，**重新整理頁面就消失**；持久化留到第 3 階段。畫面上有同樣的說明。

## 流程

1. **選檔、拖放或貼上文字**（「上傳」頁籤，`app/src/ui/UploadPage.tsx`）：
   - 頁首一排五個步驟（`ui/UploadSteps.tsx`，#242）：上傳 → 切段 → 模型萃取 → 人工審核 → 併入圖譜。完成的步驟上方是 `primary` 細條，進行中的步驟顯示真實數字（段落數、「批次 2／3」、送審筆數）。狀態由 `ui/upload-helpers.ts` 的 `uploadSteps()` 算出；上傳頁不知道審核進度，萃取完成後「人工審核」為進行中，「併入圖譜」保持未完成。
   - 拖放區是虛線框，有上傳圖示、格式與大小上限的說明；拖著檔案進入時框線變實線 `primary`、底色變淺、圖示上浮 6px（fast）。
   - 選了檔案（或拖放到虛線框）後，拖放區換成檔案卡片（檔名與大小，落定的 settle 動態），可按「清除檔案」改回貼上文字。
   - 填寫標題（選檔時預設為檔名去掉副檔名）、語言（預設為介面語言）、可見等級、專案（可無）、日期（預設為今天的本地日期，可修改或清空）。
   - 可選的等級與專案只列出目前身分看得到的；這只是方便選擇，能否寫入由資料庫的 RLS 決定。
   - **可見等級預設為目前身分能選的最嚴格等級**（rank 最高；同 rank 時取 `access.json` 中較前面的；`ui/upload-helpers.ts` 的 `defaultVisibility()`，#192），「再上傳一份」清空表單時也是。參考情境中主管預設「機密」、一般員工預設「內部」。忘了改時看得到的人比預期少，不會不小心公開給訪客；要公開或放寬，上傳者必須自己改，確認視窗的「誰看得到」是送出前的檢查點。
   - **誰看得到**：依目前選的可見等級與專案，從 `client/access.json` 算出看得到這份文件的角色（`ui/upload-helpers.ts` 的 `audienceRoles()`，與 `oracle.ts` 的讀取規則一致，`app/tests/upload/audience.test.ts` 比對），顯示在表單與確認視窗中。
2. **預覽**：在瀏覽器中擷取純文字（`parse.ts`）並切段（`chunk.ts`）。檔案不上傳到伺服器。解析失敗時，在拖放區原地換成提示框（`ui/Notice.tsx`）的固定訊息，並附「清除檔案」（有選檔時）或「重新選檔」；不搖晃，只有圖示與左側細線是錯誤色，不用大面積的紅色。
3. **確認視窗**（原生 `<dialog>`＋`showModal()`，#42）：從畫面底部升起的面板（`kUp`，base；#242 決定 1）。
   - 依序顯示檔案卡片（檔名或「貼上的文字」、段落數、字數）、前 3 段的預覽（其餘可展開）與設定摘要。預覽放在 `reading` 紙面上（Dark 也是亮色），段落逐條升起（stagger 60ms）；延遲依 [`docs/design/motion-reference.md`](design/motion-reference.md) 的「上傳」列。
   - 設定摘要先列「誰看得到」、可見等級與專案，再是標題、語言、日期，最後是「上傳」按鈕。
   - 字數：漢字與假名每字算 1，其他文字以單字計算（語言模組 `app/src/language/text.ts` 的 `wordCount()`）。
   - 右上角的 ✕、「返回修改」或 Esc 關閉視窗，表單內容保留；寫入中停用。可見等級與專案以標籤顯示（`ui/AccessBadges.tsx`，等級的顏色來自 `access.json` 的 `color`）。
   - 「上傳」以 `uploadDocument()`（`write.ts`）在一個 `withIdentity()` 交易中寫入文件與所有段落。寫入中按鈕顯示「上傳中」並停用，也不能以 Esc 關閉；同一份預覽只寫入一次（連點也一樣）。
   - 成功時在視窗內顯示段落數，並提供「到問答」「到時間軸」「再上傳一份」（清空表單）。視窗內也顯示頁首的五個步驟（頁首在面板後方會被遮住，#242 審查）。
   - **萃取與比對的動態**（#242 PR 2，延遲依 `motion-reference.md` 的「上傳」列）：預覽中，完成的批次找到的實體名稱依序畫出類型色底線（`kUnder`，sweep；名稱來自 `BatchState.found`，`ui/upload-helpers.ts` 的 `foundTerms()`、`underlineRanges()`）；說法不同的段落標 `conflictSoft`（`ConflictState.passages`）。底線與標示都在寫入成功後才出現，跟著真實進度。
   - **已送審**（#242 PR 3）：萃取完成且有送審的實體或關係時（`upload-helpers.ts` 的 `sentForReview()`），一顆標記從面板內的「人工審核」步驟飛向導覽「待審」的數量（`kFlyTo`，起點以 `flyPath()` 依實際版面算出，見 `motion-reference.md`「例外」），待審數量跳一下（`kBump`，settle；數量增加時都會跳，`App.tsx`）。每份文件只飛一次；減少動態效果時不飛、數量直接更新；沒有「待審」頁籤的身分與展示模式不飛。失敗時在視窗內以提示框顯示固定訊息，附「返回修改」；表單內容保留，修改後重新預覽。
4. **到時間軸**：切換到時間軸並捲動到剛上傳的文件，加上框線與淡色背景約 1 秒，再於約 1.5 秒內淡出（作業系統設定減少動態效果時不淡出，約 2 秒後直接取消）。時間軸只列出介面語言的文件，所以文件語言與介面語言不同時，會一併切換介面語言。本次工作階段上傳的文件在時間軸中加上「上傳」標籤。
5. **萃取實體與關係**（#44）：上傳成功後，在背景以模型萃取，結果放進待審區，由有 `canReview` 的身分核准後才進入圖譜。確認視窗與上傳頁下方的「這次上傳的文件」顯示萃取狀態，失敗時可以重試。見 [docs/extraction.md](extraction.md)。
6. 上傳的段落不需要額外處理就能被檢索到：檢索的向量快取以段落 id 為鍵，新段落下次檢索時自動計算。

時間軸依**文件日期**由新到舊排列（不是上傳時間），沒有日期的文件排在最後；日期預設為今天，所以剛上傳的文件會在最上面。

切換身分或語言時，上傳頁重建，表單、預覽與結果都清除。

## 權限

- `access.json` 的角色以 `canUpload` 決定能否上傳（參考情境：訪客 `false`，一般員工、主管 `true`）。沒有 `canUpload` 的身分只看到固定說明，不顯示表單。
- 寫入規則由 migration 0005 的 RLS 執行，見 [docs/data-model.md](data-model.md)「寫入規則」：
  - 只能寫入自己看得到的可見等級與專案。
  - 段落只能加在自己上傳的文件中，等級與專案與文件相同。
  - `kk_app` 只有 `INSERT`，沒有 `UPDATE`、`DELETE`；不能修改或刪除上傳的文件。
- 上傳後誰看得到，依既有的讀取規則決定。例如主管上傳機密文件，一般員工的檢索、問答、時間軸與原文都看不到。
- 測試：`app/tests/upload/write.test.ts`（越權寫入）、`app/tests/upload/visibility.test.ts`（上傳後的可見範圍），都以 `app/tests/db/oracle.ts` 比對。

## 格式

| 格式 | 副檔名 | 擷取方式 |
| --- | --- | --- |
| 純文字、貼上 | `.txt` | 原文（UTF-8） |
| Markdown | `.md`、`.markdown` | 只去掉語法符號（標題、引用、清單、分隔線、強調、行內程式碼、程式碼區塊的 fence）；連結只留文字，圖片去掉。不轉 HTML |
| PDF | `.pdf` | `pdfjs-dist`：逐頁 `getTextContent()`，不繪製頁面；頁與頁之間以空行分隔 |
| Word | `.docx` | `mammoth.extractRawText()`：不轉 HTML，不帶入圖片、連結、樣式 |

- PDF 與 Word 的套件以動態 import 載入，只在上傳時下載；套件的選擇、安全設定與打包大小見 [ADR 0002](adr/0002-document-parsing.md)。
- 上傳的內容在畫面上一律以文字節點顯示，不使用 `dangerouslySetInnerHTML`（`app/src/ui/effects.test.ts` 檢查）。

## 切段

`chunk(text, passageMaxChars)`：

1. 以空行分段。段落內的換行，兩側都是漢字、假名或全形標點時直接相連，否則換成空白。
2. 20 字元內的段落（通常是標題）併入下一段，讓標題留在內容的段落中。
3. 超過 `passageMaxChars` 的段落依句尾斷開：中文與日文的「。！？」，英文的 `. ! ?` 後接空白。
4. 單句仍超過上限時硬切。長度以字元（code point）計算。

步驟 1 的換行相連、步驟 3 的句尾與斷開後的句子相連（前一句以漢字、假名或全形標點結尾時不加空白），規則都在語言模組 `app/src/language/`（#83），`chunk.ts` 只負責段落的合併與長度限制。

**新增語言**：句尾標點或換行相連的方式不同時（例如句尾不是「。！？」或 `. ! ?` 的語言），只修改語言模組的 `scripts.ts`，不改 `chunk.ts`；做法見 [docs/retrieval.md](retrieval.md)「語言模組」。

`passageMaxChars` 是 `client.json` 的 `upload.passageMaxChars`（預設 300，範圍 100～1000，見 [docs/client-config.md](client-config.md)）。300 字元約是參考資料集段落的 2～3 倍；5 段合計仍遠低於問答的 `PROMPT_CHAR_BUDGET`。

## 上限

| 項目 | 上限 | 超過時 |
| --- | --- | --- |
| 檔案大小 | 10 MB | `too_large` |
| 擷取後的字數 | 50,000 字元 | `too_long` |
| 段落數 | 500 段 | `too_long` |

上限是 `app/src/upload/parse.ts` 的常數（保護瀏覽器，不讓客戶調整）。各種失敗都顯示固定訊息（翻譯檔 `client/i18n/<語言>.json` 的 `uploadErrors`）：

| 原因 | 情況 |
| --- | --- |
| `unsupported` | 不支援的副檔名 |
| `too_large`、`too_long` | 超過上限 |
| `empty` | 沒有任何文字 |
| `no_text` | PDF 沒有可擷取的文字（例如掃描檔）；不做 OCR |
| `failed` | 檔案損毀或解析失敗 |
| `denied` | 被 RLS 拒絕（等級或專案超出權限） |
| `invalid` | 標題為空或日期格式錯誤 |
| `no_input` | 沒有選檔也沒有貼上文字 |

## 測試

- `app/tests/upload/parse.test.ts`：4 種格式、各種固定錯誤。PDF 與 .docx 在測試中產生（`app/tests/upload/fixtures.ts`，虛構內容），不提交二進位檔；Vitest 中使用 PDF.js 的 legacy 版本。
- `app/src/upload/chunk.test.ts`、`markdown.test.ts`：切段與 Markdown。
- `app/src/upload/structure.test.ts`：PDF.js 沒有 eval 路徑、上傳模組只擷取文字（ADR 0002）。
- `app/src/ui/upload-helpers.test.ts`：頁首步驟的狀態與真實數字、檔案卡片的字數（#242）。
- 畫面本身沒有自動測試（DOM 測試套件未核准），以人工驗收（#38）；上傳流程由 E2E 檢查（`docs/testing.md`「Playwright」）。

## 限制

- 上傳內容重新整理就消失；不能修改或刪除。
- 複雜版面的 PDF 文字順序可能不理想；PDF 通常沒有空行，所以依句子切段。
- 不支援圖片、表格結構與 .doc、.pptx、.xlsx 等其他格式；不做 OCR。
- 上傳的文件萃取出的實體與關係，核准後才出現在圖譜中（[docs/extraction.md](extraction.md)）；萃取會呼叫模型，計入每日次數。
- 時間軸只列出介面語言的文件：上傳英文文件後，要在英文介面才會在時間軸看到（從確認視窗按「到時間軸」時會自動切換）。
- 「上傳」標籤與跳到新文件只在本次工作階段有效；不保存上傳紀錄。
