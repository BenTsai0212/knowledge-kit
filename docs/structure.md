# 結構

每個路徑的職責，以及結構測試守的界線（例如只經 `retrieve()` 取段落、客戶資料只用 `@client/…`、顏色只用 CSS 變數、語言規則只放 `app/src/language/`）。改 `app/`、`worker/`、`client/` 前先讀本文件；指令與硬規則見 [AGENTS.md](../AGENTS.md)。〔#142 從 `AGENTS.md` 第 3 節移來〕

## 寫法

平行的 PR 改到同一行就會衝突（git 以行為單位合併，有衝突的 PR 不會觸發 CI），所以本文件一個檔案一行（#314）：

- 每個路徑一個 `###` 小節：標題是路徑，下面一段簡短說明（整個路徑共同的職責與界線），再以清單列出檔案。
- 清單**一個檔案（或一組成對的檔案）一行**，格式是 `` - `檔名`：說明 ``；檔名寫相對於小節路徑的路徑（例如 `src/ask.ts`）。只列需要說明的檔案。
- 清單依每行第一個行內程式碼（檔名）排序：不分大小寫，依字元碼比較（`-`、`.`、`/` 排在數字與英文字母前）。
- 新增檔案時只在正確的位置**插入一行**，不修改既有的行；刪除或改名時只動那一行。
- 每行不超過 300 字；放不下時把細節寫到 `docs/` 的對應文件，這裡只留連結。
- 結構測試在 `scripts/structure-doc.test.mjs`（行長與排序）。

## 路徑

### `app/`

前端（Vite＋React＋TypeScript）。客戶資料一律以 `@client/…` 別名讀取，不以相對路徑指到 `client/`（`client/schema/` 除外；結構測試在 `src/client/client-dir.test.ts`）。

- `dev/`：只在 `npm run dev` 提供的開發用頁面（語意向量的量測頁，不進 `dist/`，見 `docs/retrieval.md`「瀏覽器量測」）
- `index.html`：入口 HTML
- `src/`：原始碼，各模組的資料夾見以下各節
- `src/App.tsx`：畫面的入口（見 `app/src/ui/`）；也在背景執行上傳後的萃取與說法不同的比對
- `src/client/`：`client/` 設定的型別與讀取（改 Schema 時同步修改，見 `docs/client-config.md`）
- `src/client/client-dir.test.ts`：結構測試：客戶資料只以 `@client/…` 別名讀取
- `src/client/i18n.ts`：介面文字唯一的讀取模組（`strings()`、`fill()`、`errorMessage()`；結構測試在 `i18n.test.ts`）
- `src/client/source-scan.ts`：結構測試共用的原始碼掃描

### `app/src/dataset/`

資料集（`client/data/`）的型別、鍵清單、讀取、跨檔檢查與匯入。

- `load.ts`：讀取
- `seed.ts`：匯入
- `validate.ts`：跨檔檢查

### `app/src/retrieval/`

檢索；說明見 `docs/retrieval.md`。

- `keyword-hash.ts`：預設實作 `keyword-hash`（切詞在 `tokenize.ts`）
- `providers.ts`：使用哪個實作只在這裡決定（`providers.test.ts` 檢查）
- `retrieve.ts`：經 `withIdentity()` 取段落再計分
- `scenario-cases.ts`：預設問題的檢索測試的案例與涵蓋規則
- `scenarios.target.test.ts`：預設問題的檢索測試（target 測試，案例在 `scenario-cases.ts`，一律以 `keyword-hash` 檢索）
- `semantic/`：語意向量實作（可選）
- `semantic/runtime.ts`：`@huggingface/transformers` 只在這裡以動態 import 載入
- `tokenize.ts`：預設實作 `keyword-hash` 的切詞
- `types.ts`：`VectorProvider` 接口

### `app/src/language/`

語言模組（#83）：語言或文字類別的規則；檢索的 `tokenize.ts` 與上傳的 `chunk.ts` 經由它處理，其他地方不得放這類規則（`structure.test.ts` 檢查）；說明見 `docs/retrieval.md`「語言模組」。

- `scripts.ts`：文字類別與切詞方式
- `stopwords.ts`：停用詞
- `text.ts`：對外函式

### `app/src/qa/`

問答；只透過 `retrieve()` 取得段落（`structure.test.ts` 檢查）；說明見 `docs/qa.md`。

- `answer.ts`：`ask()`（`retrieve()` → 本機拒答 → `prompt.ts` 組 prompt → `/api/ask` → 拒答標記、`unwrap.ts` 移除外層標籤與 `citations.ts` 的引用解析）
- `api.ts`、`sse.ts`：`/api/ask` 傳輸接口真的實作
- `citations.ts`：引用解析
- `compare.ts`：`askEach()`，展示模式的身分對照（每個身分各呼叫一次 `ask()`）
- `prompt.ts`：組 prompt
- `testing.ts`：`/api/ask` 傳輸接口測試用的假實作（測試不呼叫真實 API）
- `types.ts`：`/api/ask` 的傳輸接口
- `unwrap.ts`：移除外層標籤

### `app/src/ui/`

畫面（入口是 `app/src/App.tsx`）。左側導覽的頁籤切換首頁（登入後的預設頁）、問答、圖譜、時間軸、上傳、待審與評測台；問答頁是左導覽、中間對話、右側面板（原文或回答提到的實體）的三欄，見 `docs/qa.md`「畫面」。元件是 `*.tsx`；介面文字一律以 `app/src/client/i18n.ts` 的 `strings()` 取得（翻譯檔在 `client/i18n/`）。

- `access-code.ts`：邀請碼只放 `sessionStorage`
- `AccessBadges.tsx`：可見等級與專案的標籤
- `AdminNotice.tsx`：需要管理者的說明（見 `docs/qa.md`「錯誤」）
- `answer-motion.ts`：問答的逐句動態（見 `docs/qa.md`「畫面」的「動態」）
- `app.css`：樣式（顏色與圓角只用 `theme.ts` 由 `client/theme.json` 設定的 CSS 變數，深色模式依 `prefers-color-scheme` 標上 `data-scheme` 後改用 `darkColors`，不寫死顏色；結構測試在 `theme.test.ts`）
- `BottomSheet.tsx`：共用的底部面板（原生 `<dialog>`，關閉按鈕、Esc、點背景、往下拖關閉，焦點回到觸發的元件）；`expandable` 是 56%／全高，`side="right"` 是平板的右側滑出面板（原文、實體、身分與語言），`side="popover"` 是桌機左側欄旁的身分與語言選單
- `ConflictStatus.tsx`：比對狀態
- `Conversation.tsx`：問答頁中間的對話
- `cross-fade.ts`：切換語言、Light／Dark 的交叉淡換
- `entity-icons.ts`：實體類型的圖示集
- `EntityIcon.tsx`：圖例的圖示
- `EntityPanel.tsx`：圖譜頁的實體面板；桌機（`wide`）是右側整高欄的列與卡片（#336），展示模式的桌機也用（#349）
- `EntitySearch.tsx`：以名稱搜尋實體；`field` 是桌機圖譜頁首的搜尋框（#336）
- `entry-hero.ts`：入口頁主視覺版面的純函式
- `EntryBar.tsx`：桌機登入頁的頂端列（登入前沒有左側導覽，#334）
- `EntryHero.tsx`：入口頁的主視覺（見 `docs/design.md`「入口頁主視覺」）
- `eval-helpers.ts`：評測台的純函式
- `EvalPage.tsx`：評測台；桌機（`eval-page--desktop`）是 h1、按鈕列、總覽表與可點的每題結果列（#347）
- `ExtractionStatus.tsx`：萃取狀態
- `FilePicker.tsx`：檔案選擇（原生 input 視覺上隱藏，按鈕與檔名跟著主題與翻譯，見 `docs/design.md`「表單元件」）
- `gone-motion.ts`：切換身分時看不到的內容消失
- `graph-keyboard.ts`：圖譜的鍵盤操作與報讀的順序、按鍵與句型（純函式，見 `docs/graph.md`「鍵盤操作與報讀」）
- `graph-list.ts`：清單模式的分群與關係句的純函式、「圖譜｜清單」的選擇
- `graph-style.ts`：圖譜的配色（深色模式切換時重新套用）
- `graph-zoom.ts`：三層語意縮放的層級、細節層與圖上元素的純函式；`panToCenter()` 在手機實體面板開著時，把選取的節點平移到面板以上的中央；`focusViewport()` 是桌機選取時的視角（縮放上限，聚焦集合留在畫布內）
- `GraphList.tsx`：圖譜的清單模式
- `GraphPage.tsx`：圖譜頁；桌機是畫板 `Graph`、`G-Scale` 的版面（#336），展示模式的桌機是畫板 `H-Graph`（#349）
- `GraphView.tsx`：圖譜（cytoscape，動態載入）；`areaOf()`、`centerIn()` 與 `GraphZoomView` 共用；`cover` prop
- `GraphZoomView.tsx`：大量節點時的三層語意縮放（見 `docs/graph.md`「三層語意縮放（畫面）」）；`cover` prop
- `home.ts`：首頁的純函式（問過的問題與相對時間、狀態點、實體形狀等）
- `HomePage.tsx`：首頁（登入後的預設頁）；桌機（`wide`）是畫板 `K-Home` 的版面（#331）
- `identity-compare.ts`：身分對照的純函式：欄的順序與目前身分、目前的題目、一欄一欄送出、`C`／`Esc`
- `IdentityCompare.tsx`：展示模式的身分對照，每個身分一欄，沿用 `AnswerView`（純函式在 `identity-compare.ts`；畫板 `H-QA`，#349），見 `docs/qa.md`「身分對照」
- `IdentitySheet.tsx`：身分與語言面板的內容（手機、平板與桌機使用者卡的選單共用；身分單選卡附 `roles[].scope`、語言分段切換、更換邀請碼；帳號登入時只顯示帳號與角色）
- `layout.ts`：斷點（`layoutFor()`、`useLayout()`）、手機分頁的分配（`phoneTabs()`）、底部面板的拖曳門檻與 `sheetSnap()`、底部面板以上的可見部分 `visibleArea()`（純函式，測試在 `layout.test.ts`）
- `MentionPanel.tsx`：問答頁的右側面板：回答提到的實體（純函式在 `mentions.ts`）
- `mentions.ts`：`MentionPanel.tsx` 的純函式
- `MobileNav.tsx`：≤ 600px 時取代左側導覽的手機頂端列＋底部分頁列（含「更多」面板與展示模式的分段切換），見 `docs/design.md`「手機與平板」
- `motion.ts`：動態的刻度與 CSS 變數 `--motion-*`、`--ease-*`；圖譜展開的動態與「減少動態效果」的判斷
- `NavRail.tsx`：平板（601–1024px）的左側圖示導覽列，與 `Sidebar`、`MobileNav` 共用 `NavProps`；App 依 `useLayout()` 只渲染其中一種
- `Notice.tsx`：共用的提示框（`className` 依位置調整樣式，例如桌機問答頁的額度與需要管理者的說明條）
- `online-demo.ts`：唯一讀取處：線上 demo 的 `VITE_ONLINE_DEMO`、`VITE_PUBLIC_ACCESS_CODE`（預設關閉；開啟時隱藏評測台），展示模式 `?mode=presentation`（只顯示問答與圖譜），評測台的 `?tools=evals`，身分對照的 `VITE_DEMO_COMPARE`（預設關閉、線上 demo 一律關閉）；見 `docs/qa.md`「線上 demo」「展示模式」「身分對照」、`docs/evals.md`「開啟評測台」
- `PassageMarks.tsx`：時間軸與原文面板的標示
- `PathPanel.tsx`：圖譜頁的路徑面板；`panel` 是桌機「找路徑」打開的面板（#336）
- `PresentationBar.tsx`：展示模式登入後的頂端列（不論寬度都取代 `Sidebar`／`MobileNav`；畫板 `H-QA`、`H-Graph`，#349）；`VITE_DEMO_COMPARE` 開啟時有「身分對照」按鈕，見 `docs/qa.md`「展示模式」「身分對照」
- `ProductIcon.tsx`：頁首的產品 icon（favicon 在 `app/public/favicon.svg`，見 `docs/design.md`「產品 icon（K 晶格）」）
- `qa-errors.ts`：問答錯誤的五類（見 `docs/qa.md`「錯誤」）
- `refusal-next-steps.ts`：拒答下方的下一步（見 `docs/qa.md`「拒答」）
- `report-helpers.ts`：問答的「回報有錯」組成回報
- `ReportList.tsx`：待審頁的「回報」分頁
- `ReportResult.tsx`：回答下方與首頁的回報結果
- `requests.ts`：切換身分或語言時捨棄進行中的提問
- `review-helpers.ts`：待審頁的核准計畫
- `ReviewPage.tsx`：待審頁（含「說法不同」的並列與處理；桌機照畫板 `F-Review`、`F-Empty`，#345）
- `script.ts`：劇本的純函式（分組與順序、第 N／M 題、已問過、是否切換身分）
- `ScriptPanel.tsx`：展示模式問答頁左欄的劇本（畫板 `H-QA`，#349），見 `docs/qa.md`「展示模式」
- `SessionQuestions.tsx`：手機的「這次的問題（N）」按鈕與底部面板（#256）
- `Sidebar.tsx`：桌機的左側欄（客戶名稱、頁面項目、「虛構資料 · 展示用權限」、使用者卡與身分和語言選單，#330）
- `source-steps.ts`：「出處 N／M」與「在圖譜中查看」目標的純函式
- `SourcePanel.tsx`：桌機的原文欄（段落編號、「這次回答的出處」，#335）；展示模式是浮動的原文卡片（#349）
- `SourceSheet.tsx`：手機的原文面板（底部面板，標題「原文 · 出處 N／M」，#354）與平板的滑出面板
- `SourceText.tsx`：原文紙面，桌機與手機共用
- `theme.ts`：由 `client/theme.json` 設定 CSS 變數（深色模式用 `darkColors`）
- `timeline-view.ts`：時間軸的區段與篩選、桌機的年份分組、範圍與說法不同的純函式
- `TimelinePage.tsx`：時間軸（見 `docs/graph.md`）

### `app/src/graph/`

知識圖譜；說明見 `docs/graph.md`，權限測試在 `app/tests/graph/`。

- `clusters.ts`：大量節點時的門檻、分群與聚合線（純函式，只用可見圖，#254）
- `expansion.ts`：圖譜頁逐步展開的狀態（純函式，只用可見圖）
- `path.ts`：`shortestPath()` 在可見圖上找最短路徑
- `read.ts`：`readGraph()` 經 `withIdentity()` 一次讀出看得到的實體、關係與出處段落
- `recent.ts`：首頁的「最近新增的文件」與「最近看過」的實體
- `search.ts`：圖譜頁的搜尋、類型篩選與「關聯最多」（純函式，只用可見圖）
- `timeline.ts`：`readTimeline()` 依日期列出看得到的文件與段落

### `app/src/upload/`

上傳；說明見 `docs/upload.md`。畫面是 `app/src/ui/UploadPage.tsx`（桌機的頁首、分段切換與右側的上傳詳情欄，#344），其中「我的上傳」的清單、上傳詳情與「看原文」是 `app/src/ui/MyUploads.tsx`，狀態、四步進度、處理中的數量、上傳詳情的萃取階段、原文中標出的實體與手機「上傳」分頁小點的純函式在 `app/src/ui/my-uploads.ts`。

- `chunk.ts`：切段
- `docx.ts`：以動態 import 載入 `mammoth`（見 ADR 0002）
- `markdown.ts`：Markdown 的擷取
- `parse.ts`：擷取純文字（上限是這裡的常數）
- `pdf.ts`：以動態 import 載入 `pdfjs-dist`（見 ADR 0002）
- `write.ts`：`uploadDocument()` 經 `withIdentity()` 寫入文件與段落（`kk_app` 唯一的寫入；權限由 RLS 執行，見 `docs/data-model.md`「寫入規則」，測試在 `app/tests/upload/`）

### `app/src/extraction/`

上傳文件的萃取；說明見 `docs/extraction.md`。

- `batch.ts`：分批
- `merge.ts`：合併比對
- `output.ts`：解析與驗證
- `prompt.ts`：prompt
- `run.ts`：分批呼叫 `/api/ask`
- `store.ts`：經 `withIdentity()` 寫入待審、讀取待審區與我的上傳（`readMyUploads()`，附文件日期與第一個看得到的段落）、核准與退回（只用 INSERT；規則由 RLS 執行，見 `docs/data-model.md`「待審與核准」，測試在 `app/tests/extraction/`）

### `app/src/conflicts/`

上傳文件與既有段落的說法不同（#51）；說明見 `docs/conflicts.md`。

- `marks.ts`：時間軸與原文面板的標示（在 `readTimeline()`、`readSource()` 的交易中讀取）；桌機回答卡片的說法不同提示（`citedConflicts()`：兩段都被引用的並存組合）
- `output.ts`：解析與驗證
- `prompt.ts`：prompt
- `run.ts`：在萃取後以上傳者的身分挑選段落、呼叫一次 `/api/ask`、解析與驗證
- `select.ts`：挑選段落
- `store.ts`：經 `withIdentity()` 寫入偵測結果、讀取與處理（只用 INSERT；規則由 RLS 執行，見 `docs/data-model.md`「說法不同」，測試在 `app/tests/conflicts/`）

### `app/src/reports/`

回答錯誤回報（ADR 0007 決定 7）。畫面是問答的「回報有錯」（`app/src/ui/AnswerView.tsx`）與待審頁的「回報」分頁（`app/src/ui/ReportList.tsx`），見 `docs/qa.md`「回報有錯」。

- `store.ts`：經 `withIdentity()` 寫入回報、讀取與處理（只用 INSERT；規則由 RLS 執行，見 `docs/data-model.md`「回答錯誤回報」，測試在 `app/tests/reports/`）

### `app/src/evals/`

評測台（#62）；說明見 `docs/evals.md`，畫面是 `app/src/ui/EvalPage.tsx`；測試只用假的 `/api/ask`。

- `grade.ts`：模型評分的 prompt 與解析（全文在 `docs/evals.md`，`docs.test.ts` 檢查）
- `keys.ts`：題庫（`client/evals/`）的鍵清單
- `load.ts`：題庫的讀取
- `oracle.ts`：權限讀取規則的獨立實作（`expectedVisible()`，`app/tests/db/oracle.ts` 重新匯出）
- `report-html.ts`：把 `report.ts` 的內容轉成自成一頁的 HTML（A4 每頁一個 `section.page`，附錄的分頁 `appendixPages()`，#347）
- `report.ts`：給客戶的品質報告的內容（純函式，只放序號、類別、身分、數字與判定）
- `run.ts`：執行（評測專用的記憶體資料庫 `openEvalDatabase()`、預計呼叫次數、逐題執行、停止與錯誤處理、兩組檢索設定）
- `score.ts`：評分的純函式（引用、關鍵重點、拒答、禁止內容、滲漏、指標彙總；滲漏的反向驗證在 `app/tests/evals/`）
- `types.ts`：題庫的型別
- `validate.ts`：需要資料集的檢查

### `app/src/sources/`

引用跳回原文。

- `source.ts`：`readSource()` 經 `withIdentity()` 讀取段落所屬文件中看得到的段落；`readCitedSources()` 讀取一題回答引用到的段落的文件標題與段落編號

### `app/src/db/`

資料層（PGlite＋RLS）；說明見 `docs/data-model.md`。

- `database.ts`：唯一入口
- `migrations/*.sql`：migration

### `app/tests/`

需要放在 `app/src/` 之外的測試（例如會用到被禁止 SQL 的越權測試）。

- `fixtures/large-graph.ts`：圖譜分群用的虛構大型資料（固定種子、240 個實體，不放進 `client/`，#254）

### `worker/`

Cloudflare Worker（TypeScript）：`GET /api/health`、`POST /api/ask`；其他請求交給 `dist/` 靜態檔。API 格式、錯誤類型、secret 與已知限制見 `worker/README.md`。

- `src/ask.ts`：`POST /api/ask` 的同站、邀請碼、body、每日次數的檢查
- `src/models.ts`：模型白名單
- `src/sse.ts`：轉成精簡的 SSE
- `src/testing.ts`：測試用的假實作
- `src/upstream.ts`：轉發到 Claude Messages API
- `src/usage.ts`：計數用的 Durable Object

### `client/`

客戶設定；參考情境與測試基準，`KK_CLIENT` 可改用 `clients/<名稱>/`；說明見 `docs/client-config.md`、`docs/dataset.md`。

- `*.json`：客戶設定
- `data/`：虛構資料集
- `evals/questions.json`：評測題庫（見 `docs/evals.md`）
- `i18n/<語言>.json`：介面翻譯檔（含拒答文字與各錯誤訊息）
- `schema/`：JSON Schema

### `clients/`

各客戶的設定（`clients/<名稱>/`，結構同 `client/` 但不含 `schema/`）；本 repo 只放虛構的示範客戶，真實客戶放在各自的 fork（#77 決定 7、`clients/README.md`）。

### `e2e/`

Playwright 的端對端測試（`*.spec.ts`）；設定在根目錄的 `playwright.config.ts`，說明見 `docs/testing.md`。

- `access.spec.ts`：越權
- `compare.spec.ts`：展示模式的身分對照，只在 `VITE_DEMO_COMPARE=1` 的 build 執行畫面的測試（比對文字只出現在一個答案段落的檢查不需要開關）
- `demo.spec.ts`：線上 demo 的設定，只在 `VITE_ONLINE_DEMO=1` 的 build 執行
- `entry-touch.spec.ts`：入口（手機與平板）與觸控目標（#255 PR 4）
- `evals-desktop.spec.ts`：桌機的評測台與品質報告（1440×900，#347）
- `fixtures/`：上傳用的虛構檔案
- `graph-desktop.spec.ts`：桌機的圖譜（1440×900）的版面、實體欄與縮放按鈕
- `graph-mobile.spec.ts`：手機的圖譜（390×844）的版面、「篩選與找路徑」與實體面板
- `home.spec.ts`：首頁
- `interactions.spec.ts`：互動邊角
- `layout.spec.ts`：三欄版面
- `mentions.spec.ts`：回答提到
- `mobile-pages.spec.ts`：手機的時間軸、上傳、待審、評測台與更多（375×812）
- `mobile-qa.spec.ts`：手機的問答與原文面板（390×844）
- `mobile.spec.ts`：手機的共同結構（390×844）
- `presentation.spec.ts`：展示模式
- `qa-desktop.spec.ts`：桌機的問答頁與原文欄（1440×900，#335）
- `reports.spec.ts`：回答錯誤回報
- `retract.spec.ts`：撤回
- `review-desktop.spec.ts`：桌機的待審頁（1440×900，#345）
- `review.spec.ts`：待審頁
- `smoke.spec.ts`：冒煙
- `support/app.ts`：共用操作（介面文字從選定客戶的 `i18n/` 讀取）
- `support/citing-answer.ts`：引用每一段的假回答，找到檢索到至少 2 段的預設問題（手機與桌機的原文面板共用）
- `support/client.ts`：讀取 `KK_CLIENT` 選定客戶的 JSON 並推算測試用的身分（不寫死角色、等級、專案）
- `support/dataset.ts`：以 `app/src/evals/oracle.ts` 算出各身分看不到的段落；身分對照用的「只有一個身分看得到的題目」與只出現在答案段落的比對文字（`onlyOneSees()`）
- `support/fake-ask.ts`：假的 `/api/ask`（含串流到一半的假回應）
- `support/skip-reporter.ts`：列出略過的測試與原因（參考情境有略過時失敗）
- `timeline-desktop.spec.ts`：桌機的時間軸（1440×900，#346）與平板不變

### `scripts/`

專案腳本（Node ESM，不在 `typecheck` 範圍內）。

- `check-client.mjs`：客戶檢查
- `check-clients.mjs`：客戶檢查（所有客戶）
- `check-sensitive.mjs`：敏感資料檢查
- `client-dir.mjs`：`KK_CLIENT` 對應的客戶資料夾（`vite.config.ts`、`vitest.config.ts`、`vitest.clients.config.ts` 與 `check-client.mjs` 共用）
- `doc-commands.test.mjs`：Markdown 的 shell 指令區塊不加 `#` 註解，說明寫在區塊外
- `fixtures/invalid-client/`：故意寫錯的測試資料
- `ort-wasm.mjs`：語意向量 provider 的 ONNX Runtime WASM：build 時依客戶設定複製到 `dist/ort/` 並檢查單檔上限（`vite.config.ts` 使用）
- `playbook.test.mjs`：`docs/playbook/` 繁中與英文的檔名、`##` 標題數量與相對連結
- `structure-doc.test.mjs`：本文件的寫法（清單每行不超過 300 字、每個小節的清單依檔名排序）

### 根目錄

根目錄的指令與設定（單一 `package.json`，不用 workspaces）。

- `package.json`：指令與相依套件
- `playwright.config.ts`：Playwright 的設定
- `tsconfig.node.json`：根目錄設定檔的 tsconfig
- `vite.config.ts`：Vite 的設定
- `vitest.clients.config.ts`：客戶檢查的 target 測試
- `vitest.config.ts`：Vitest 的設定
- `wrangler.jsonc`：頂層供本機 `wrangler dev`，`env.demo` 是線上 demo

### `docs/`

文件。

- `adr/`：決策紀錄
- `deploy.md`：線上 demo 的部署步驟、驗收清單、回退與費用上限（部署由人執行；ADR 0005）
- `design/v1/boards/`：設計畫布「畫面流程圖」引用的畫板原始碼（`*.dc.html`，原樣保存、以 sha256 核對）；視覺以畫板為準，只供參考，不被 `app/` import、不進 build（#329）
- `design/v1/boards/README.md`：畫板與頁面的對照、顏色名稱與 token 的對照、不實作的內容與已知衝突
- `playbook/`：方法與文件套件（需求確認清單、資料盤點表、資料安全說明、評測題庫建立步驟、驗收指標、落地新客戶步驟 `new-client-setup.md`）；入口是 [docs/playbook/README.md](playbook/README.md)，英文版在 `docs/playbook/en/`，兩份一起改
- `rfcs/`：專案章程
- `workflow/`：憲法與 workflow 手冊

### `tools/workflow/`

workflow 工具（Node，自帶 `package.json`；各工具的參數見 `tools/workflow/README.md`）；`bootstrap-github.mjs`、`config.json` 不適用（見 `AGENTS.md` 第 2 節）。

- `check-post-body.mjs`：agent 貼出 PR 描述與留言前的檢查（#104）
- `check-pr-body.mjs`：檢查 PR 描述有 `Closes`／`Refs #N`（`fast-lane` 除外）
- `doc-rules.test.mjs`：檢查規則文件（一份正本、相對連結、`AGENTS.md` 的行數上限）
- `hooks/confirm-main.mjs`：合併與 push 到 main 前的確認 hook
- `personal-paths.test.mjs`：檢查開發流程工具的檔案沒有 `/Users/<名稱>`、`/home/<名稱>` 形式的個人路徑（#96，fork 後要改的地方見 `docs/workflow/fork.md`）
- `read-trusted.mjs`：讀取 Issue 與 PR，只輸出可信身分的內容（#127）
- `runner/`：自動化模組的 runner（ADR 0003，指令見 `AGENTS.md` 第 2 節）

### `.claude/`

Claude Code 設定。

- `settings.json`：在 `PreToolUse`（Bash）註冊確認 hook

### `templates/`

Claude Project 範本與預設不啟用的模組檔案。

### `.github/`

Issue／PR 範本、標籤定義與 CI；沒有部署 workflow。

- `workflows/ci.yml`：`checks` 與 `clients` job
- `workflows/e2e.yml`：Playwright，參考情境與每個客戶各一格
- `workflows/pr-body.yml`：PR 描述檢查
- `workflows/sensitive.yml`：敏感資料檢查
