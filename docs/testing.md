# 測試與 CI 的檢查

單元測試、型別檢查與 build 的指令見 [AGENTS.md](../AGENTS.md) 第 2 節。本文件說明 CI 的 job、#66 加入的敏感資料檢查與 Playwright；套件與執行檔的來源見 [ADR 0004](adr/0004-e2e-and-secret-scanning.md)。

## CI 的 job

| workflow | job | 內容 | 什麼時候執行 |
| --- | --- | --- | --- |
| `workflows/ci.yml` | `checks` | 依序執行 `npm ci` → 確認沒有下載 CUDA → `npm run check:client` → `npm run typecheck` → `npm test` → `npm run build` → workflow 工具測試（`npm test --prefix tools/workflow`） | 每個 PR 與 push 到 `main` |
| `workflows/ci.yml` | `clients` | `npm run check:clients`（[docs/client-config.md](client-config.md)「客戶檢查」） | 每個 PR 與 push 到 `main` |
| `workflows/pr-body.yml` | `pr-body` | PR 描述要連到 Issue（`tools/workflow/check-pr-body.mjs`，見 [tools/workflow/README.md](../tools/workflow/README.md)） | PR 開啟、編輯、更新與標籤變更 |
| `workflows/sensitive.yml` | `sensitive-names`、`gitleaks` | 見下方[敏感資料檢查](#敏感資料檢查) | 每個 PR 與 push 到 `main`；手動觸發時掃描整段歷史 |
| `workflows/e2e.yml` | `list`、`playwright`、`demo` | 見下方 [Playwright](#playwright) 的「CI」 | 每個 PR（目標 `main`）與 push 到 `main`，另可手動執行；不是必要檢查 |

`ci.yml` 與 `e2e.yml` 設定 `ONNXRUNTIME_NODE_INSTALL=skip`：`@huggingface/transformers` 帶進的 `onnxruntime-node` 在 linux/x64 安裝時會從 NuGet 下載 CUDA，app 用不到它（#163）。

main 的分支保護（必要檢查）見 [agent-workflow.md](workflow/agent-workflow.md)「Agent 不做的事」。

## 敏感資料檢查

`.github/workflows/sensitive.yml` 在每個 PR 與 push 到 `main` 時執行，分成兩個 job，任何一個失敗就擋下：

| job | 檢查 | 工具 |
| --- | --- | --- |
| `sensitive-names` | 個人 email、禁用名稱（客戶、合作夥伴等） | `scripts/check-sensitive.mjs`（自寫，不用套件） |
| `gitleaks` | 金鑰、token | gitleaks（固定版本＋SHA-256） |

repo 預計公開，CI 紀錄也會公開，所以兩者的輸出都**不包含命中的內容本身**：腳本只輸出檔案、行號（整段歷史模式是 commit 短 SHA）與清單第幾項，gitleaks 以 `--redact` 遮蔽金鑰。

三種模式（#99、#111）：

| 模式 | 範圍 | 什麼時候執行 |
| --- | --- | --- |
| 目前的檔案 | 腳本：`git ls-files` 列出的檔案；gitleaks：PR 或 push 新增的 commit | 每個 PR 與 push 到 `main`（自動） |
| 整段歷史 | 所有 ref 的每個 commit：腳本掃描新增的行、commit 訊息與作者名稱，gitleaks 掃描每個 commit 的變更 | 手動；**公開 repo 前本機與 CI 各跑一次** |
| GitHub | 只有腳本：所有 Issue 與 PR 的文字與編輯紀錄 | 手動；**公開 repo 前由人在本機執行**，不在 CI 執行 |

### `scripts/check-sensitive.mjs`

本機執行：`npm run check:sensitive`。

- 只掃 `git ls-files` 列出的檔案（尚未 `git add` 的新檔不在範圍內），略過含 NUL 位元組的二進位檔。
- **email**：以下放行，其他一律失敗。
  1. 帳號是 `noreply` 的地址，以及 `noreply.github.com` 與其子網域（GitHub 的 noreply 地址）。帳號是 `git` 的地址（`git@<主機>`，SSH 的 clone 網址，例如 `git@github.com:<owner>/<name>.git`；與 template 相同，#149）。
  2. `example.com`、`example.org`、`example.net` 與其子網域（RFC 2606）。
  3. 頂級網域 `.test`、`.example`、`.invalid`、`.localhost`（RFC 2606／6761），以及文件說明格式時常用的 `.tld`（例如 `local@domain.tld`；不是實際存在的頂級網域，#113）。目前的檔案、整段歷史與 GitHub 三種模式都適用。
  4. 資料集使用的虛構網域：腳本中的 `FICTIONAL_DOMAINS`，目前是空的。資料集加入虛構網域的 email 時一起修改。

  頂級網域不是英文字母的不算 email（例如 `pkg@1.2.3` 這類套件版本）。文件或範例需要 email 時，使用 `example.com` 等保留網域。
- **禁用名稱**：清單一行一項，`#` 開頭的行是註解。檔案的每一行與清單的每一項都先做 NFKC、轉小寫、去掉所有空白，再比對子字串，所以全形、大小寫不同、中間夾空白的寫法也會被擋。「第幾項」只算有效的項目（不含註解與空行）。

### 整段歷史模式

本機執行：`npm run check:sensitive -- --history`（名單與比對規則和目前的模式相同）。

- 範圍是 `git log --all` 的每個 commit，所以只含本機有的 ref；遠端分支先 `git fetch`。後來刪掉的檔案、改掉的行也會掃到。
  - **新增的行**：每個 commit 與第一個 parent 的差異中 `+` 開頭的行（第一個 commit 與空白比較，合併 commit 與第一個 parent 比較）。二進位檔沒有內容，略過。
  - **commit 訊息**與**作者、提交者名稱**：比對 email 與禁用名稱。
  - **作者、提交者的 email**：不在放行清單內的不逐筆列出，只依地址分組統計 commit 數量（「第 1 個地址，N 個 commit」，不輸出地址本身）。帳號的主要 email 屬於這一類。
  - **已知保留**：依 RFC 0002 待決問題 1 的決定（A1，Epic #93 的 `## 決定`），歷史中的這些 email 保留、不改寫歷史。PR #94 的合併 commit（`19a2cbc`，腳本中的 `KNOWN_EMAIL_BOUNDARY`）之前（它的祖先，不含它本身）的 commit，作者與提交者 email 另外列出數量（「已知保留的作者或提交者 email……：N 個地址，M 個 commit」），不算失敗；這個 commit 本身與之後的照常算失敗（#113）。repo 中沒有這個 commit 時（例如 fork 後重新開始的歷史）沒有已知保留。
- 輸出：`<短 SHA> <檔案路徑、「commit 訊息」或「作者名稱」> 命中禁用名稱清單第 N 項`（或「有不在放行清單內的 email」），同一個 commit 的同一處每一項只列一次，不輸出行號與命中的文字。最後一行列出掃描的 commit 數。
- 有任何命中、分界之後的作者 email 或錯誤時結束碼為 1；只有已知保留的 email 時結束碼為 0。
- 只掃 git 的內容，不掃 Issue 與 PR 的文字（見下方「GitHub 模式」）。

**CI**：Actions → Sensitive data → Run workflow，`full_history` 勾選（預設），或 `gh workflow run sensitive.yml -f full_history=true`。

- 兩個 job 都先以 `fetch-depth: 0` 取得所有分支與 tag，再 `git fetch` 所有 PR 的 head（`refs/pull/*/head`，分支刪除後仍在 GitHub 上，公開後看得到）。
- `sensitive-names` 以 secret `SENSITIVE_NAMES` 執行 `--history`；`gitleaks` 執行 `gitleaks git --redact`，不帶 `--log-opts`，掃描所有 ref。
- 手動觸發但不勾 `full_history` 時，腳本掃描目前的檔案，gitleaks 掃描所選分支的整段歷史。
- `workflow_dispatch` 只對預設分支上已有的 workflow 有效，所以這個模式在 #99 合併到 `main` 後才能執行。

### GitHub 模式

公開現有 repo（RFC 0002 待決問題 1 的決定 A1）時，Issue 與 PR 的文字也會公開，GitHub 還保留每段文字的編輯紀錄（#111）。

本機執行：`npm run check:sensitive -- --github`（名單與比對規則和目前的模式相同）。

- 需要 `gh` 已登入（由人執行 `gh auth login`）；沒有登入時以錯誤停止。對象是 `gh repo view` 的 repo，可用環境變數 `GH_REPO` 指定。
- 以 `gh api graphql` 讀取**所有** Issue 與 PR（含已關閉），每一層都讀完全部分頁：
  - 標題、描述、留言，PR 的 review 內文與 review comment
  - 以上每一段的**編輯紀錄**（`userContentEdits`；已刪除的版本沒有內容，不掃描）與改名前的標題
- 比對：禁用名稱、email 與目前的模式相同；另外檢查個人路徑（`/Users/<名稱>`、`/home/<名稱>`；規則 `PERSONAL_PATH` 由 `tools/workflow/personal-paths.test.mjs` 與貼出前的檢查 `tools/workflow/check-post-body.mjs` 匯入共用，#124）。GitHub Actions 的執行環境 `/home/runner` 不算個人路徑（#113），`/home/runner2` 等其他名稱與 `/Users/runner` 照常命中。
- 輸出：`<Issue 或 PR #編號> <標題、描述、留言 <網址>、review <網址> 或 review comment <網址>>`，命中編輯紀錄時加上「編輯紀錄第 N 版（時間）」（第 1 版最舊），再接清單第幾項、「有不在放行清單內的 email」或「有個人路徑」；不輸出命中的文字。最後一行列出讀取的 Issue、PR 與文字段數。
- 有任何命中或錯誤時結束碼為 1。遇到 API 速率限制時等待 60 秒後重試，重試 3 次仍受限時停止並說明，以 `gh api rate_limit` 查看重置時間後重新執行。
- 不加進 CI，不修改 GitHub 上的任何內容。

**公開前**由人在本機以 `.sensitive-names.local` 執行一次。命中時由人在 GitHub 網頁處理：修改現在的內容，或在編輯紀錄（「edited」選單）中刪除該版本；再執行到 0，結果（只有數字與位置）貼回 #111。改名前的標題是時間軸上的事件，網頁上無法刪除；命中時由人決定處理方式。

### 單一檔案模式

送出 Issue 或留言前的自我檢查（例如決策中心，`docs/workflow/decision-center.md` 第 5 節）：`npm run check:sensitive -- --file <檔案>`（#136）。

- 檢查一個檔案，不必在 git 中；相對路徑以目前目錄為準（經 `npm run` 執行時是 repo 根目錄）。
- 比對：禁用名稱、email 與目前的模式相同，另外檢查個人路徑（規則與 GitHub 模式相同）。
- 輸出：`<檔案>:<行號>` 接清單第幾項、「有不在放行清單內的 email」或「有個人路徑」，依行號排列，不輸出命中的文字。
- 有任何命中或讀不到檔案時結束碼為 1；`--file` 後面沒有路徑時結束碼為 2。
- 貼出 PR 描述與留言前的檢查是 `tools/workflow/check-post-body.mjs`（另檢查開頭與檔案是否為舊檔，不比對禁用名稱）。

### 禁用名稱清單的設定

清單內容由人設定，agent 不讀取、不建立、不猜測內容。

- **CI**：repo secret `SENSITIVE_NAMES`（Settings → Secrets and variables → Actions），內容與本機清單檔相同的格式，一行一項。只在 `sensitive-names` job 執行腳本的 step 以環境變數傳入。
  - CI 中（`CI=true`）讀不到 secret 或內容沒有任何有效項目時，job 失敗並說明原因，不會默默通過。
  - GitHub 不提供 secret 給 fork 來的 PR，這類 PR 的 `sensitive-names` job 會失敗（ADR 0004）。
- **本機**：repo 根目錄的 `.sensitive-names.local`（已加進 `.gitignore`）。沒有這個檔案時，腳本顯示警告、略過名稱檢查，email 照常檢查。設定了環境變數 `SENSITIVE_NAMES` 時以環境變數為準。

### gitleaks

- 版本與 SHA-256 寫在 `sensitive.yml` 的 `GITLEAKS_VERSION`、`GITLEAKS_SHA256`。升級時依 ADR 0004 重新查證版本、檢查碼與 CVE，同時修改兩者與 ADR。
- 掃描範圍：PR 是 `base..head` 之間新增的 commit，push 到 `main` 是 `before..after`；手動觸發整段歷史模式時是所有 ref（見上方「整段歷史模式」）。不加自訂規則檔，也不加 allowlist。
- 每次執行前，先在 `$RUNNER_TEMP` 產生假的 GitHub token 與 AWS access key，確認 `gitleaks dir` 會擋下（反向驗證）；沒擋下時 job 失敗。假金鑰不寫進 repo。
- 整段 git 歷史的掃描：CI 的手動觸發（見上方）。在本機執行時由人執行（安裝 gitleaks 是人的決定，見 AGENTS.md 第 6 節）：`gitleaks git --redact --exit-code 1`，在 repo 根目錄執行；第一次的結果記錄在 #66。

## Playwright

畫面層的端對端測試（`@playwright/test`，只用 Chromium）。測試在 `e2e/`，不在 Vitest 的範圍內，`npm test` 不會執行；型別檢查包含在 `npm run typecheck`（`e2e/tsconfig.json`）。

- 對 `npm run build` 產生的 `dist/` 執行：`playwright.config.ts` 的 `webServer` 以 `vite preview`（port 4173）提供預覽頁。
- `/api/ask` 一律由測試以 `page.route` 回傳假的 SSE（`e2e/support/fake-ask.ts`），依 `system` 的開頭分辨問答、萃取、比對與評分；不使用真實金鑰，也不啟動 Worker。不認得的請求回錯誤，測試因而失敗。
- 畫面文字一律從選定客戶的 `i18n/` 讀取（`e2e/support/app.ts`），只用預設語言；身分以左側導覽的選單切換。
- 不使用固定的等待時間，只靠 Playwright 的自動等待與會重試的斷言；資料庫是否載入完成，以預設問題的按鈕可以按為準。
- `workers: 1`（每個頁面在瀏覽器內建一個 PGlite）；CI 中失敗時重試 2 次，第一次重試時記錄 trace，失敗時保留截圖。
- `e2e/tsconfig.json` 加入 `vite/client` 的型別，因為測試匯入的 `app/src/evals/oracle.ts` 會連帶檢查使用 `import.meta.glob` 的檔案；沒有 `@types/node`，用到的 `node:fs` 與 `process.env` 在 `e2e/support/node-fs.d.ts` 自行宣告。

### 客戶（#77）

測試不寫死角色、等級、專案或實體類型，對參考情境 `client/` 與 `clients/<名稱>/` 都能執行。

- **選定客戶**：與 build 相同，以 `KK_CLIENT` 選擇（`scripts/client-dir.mjs` 的 `resolveClientDir()`）；`e2e/support/client.ts` 在 Node 端以 `fs` 讀取該客戶的 JSON。build 與測試要用同一個 `KK_CLIENT`。
- **身分**由 `access.json` 推算，都取可見等級 rank 最高者（同分時取較前面的）：能審查的身分（參考情境是 `manager`）、不能審查的身分（`staff`）、能上傳的身分、能上傳也能審查的身分。假萃取的實體類型是 `knowledge-model.json` 的第一個，名稱在 `client.languages` 的每種語言都相同。
- **語意模型不下載**（#175）：`openApp()` 與 `demo.spec.ts` 以 `blockModelDownload()` 擋下 `huggingface.co` 的請求（`e2e/support/app.ts`）。選用語意向量的客戶在頁面上降級到 `keyword-hash`，並顯示降級提示；預設問題與其他測試只靠預設語言的同語言檢索。用到的預設問題是第一個情境的第一題（`presetQuestions[0]`）與第一個角色不是 `access.json` 第一個角色的題目（`access.spec.ts`），這兩題要有預設語言的答案段落；其他預設問題的答案可以只在其他語言（`clients/kestrova-demo/`）。`keyword-hash` 的客戶不會發出這類請求，不受影響。
- **前提不成立時略過**：例如沒有不能審查的身分、資料集中沒有某身分完全看不到的文件，該測試以 `test.skip(條件, 原因)` 略過。`e2e/support/skip-reporter.ts` 在輸出與 CI 的 job summary 列出略過的測試與原因；**參考情境不得有任何略過**，有的話整次執行算失敗（#77 決定 4）。

### 測試內容

| 檔案 | 內容 |
| --- | --- |
| `smoke.spec.ts` | 冒煙（以 `?tools=evals` 打開）：問答附出處、圖譜、時間軸、上傳與待審、評測台能打開並完成基本操作；上傳的可見等級預設為各身分最嚴格的等級，等級較低的身分不在「誰看得到」 |
| `access.spec.ts` | 越權：打開原文後切換身分，原文面板與時間軸不殘留看不到的段落；串流回答中切換身分；待審只給 `canReview` 的身分；沒有 `?tools=evals` 時所有身分都看不到評測台，帶參數時只給 `canReview` 的身分；在評測台切換成沒有 `canReview` 的身分；查不到時，同一身分問「資料沒寫」與「看不到的段落」的拒答與下一步完全相同，能上傳的身分可以從「到上傳頁」切到上傳頁籤（#192） |
| `interactions.spec.ts` | 互動邊角：上傳寫入中按 Esc；評測執行中離開頁籤再回來顯示「已停止」；深色模式（`emulateMedia`） |
| `review.spec.ts` | 待審頁（#189）：上傳走查用的通知（`fixtures/walkthrough-notice.md`），1280×720 的第一個畫面看得到摘要、進度與需要確認的組，系統已準備收合成一行並附可見範圍提示，「核准這份文件的全部」後沒有遺留待審；依參考情境的圖譜，其他客戶略過 |
| `review-desktop.spec.ts` | 桌機的待審頁（#345，畫板 `F-Review`、`F-Empty`）：1440×900 時有 h1（28px）、空狀態是虛線框且第一個下一步是 `primary` 按鈕；上傳後文件卡片比 960px 寬、標頭有上傳者的膠囊，萃取結果列至少 56px、`surfaceRaised` 底，「確認」是 `primary`、「退回」是 `border` 外框，「編輯名稱」「出處」是外框按鈕（沒有底線）；沒有橫向捲動，英文介面也不破版；平板（900px）不套用桌機版面；截圖附在報告（`review-empty-1440px.png`、`review-1440px.png`、`review-en-1440px.png`） |
| `retract.spec.ts` | 撤回（ADR 0007，#209）：核准整份文件後按提示的「撤銷」，項目回到待審、圖譜搜尋不到；從圖譜面板「撤回此文件對它的核准」，確認前列出會消失的實體、取消時不撤回，確認後圖譜搜尋不到、項目回到待審；需要同時能上傳與審查的身分 |
| `reports.spec.ts` | 回答錯誤回報（ADR 0007，#209）：沒有 `canReview` 的身分回報回答（預設原因、改原因、填說明），送出後沒有待審頁籤；看得最多的審核者在「回報」分頁看到回報者、原因、說明與回答，引用編號打開原文，附給回報的人的說明（含 HTML 標籤）標示為不是錯誤後顯示處理結果與說明；回報的人在首頁「有更新」以「看處理結果」看到不是錯誤、處理者的角色與說明（以文字顯示），「仍有疑問，再回報一次」展開表單（#286）；拒答的回報預設原因是「資料中有答案，卻拒答了」，只含問題文字、只能標示為不是錯誤，審核者自己回報並處理後，回到問答頁時原本的回答下方顯示處理結果（#286）。「送出的段落中有一段看不到時看不到該回報」由 RLS 測試驗證（每個客戶都只有一個能審核的身分） |
| `layout.spec.ts` | 問答頁的三欄版面（#195）：1280×720 的第一個畫面看得到輸入框、最新一題的回答與右側的原文面板，整頁不捲動；問答往下累積、輸入框位置不變、同一題問兩次送出的內容相同（不帶上一題），切換身分時清除；串流中停用送出與預設問題；手機寬度（390×844）頂端列在對話上方、分頁列在視窗底部、沒有橫向捲動、可以提問並看到原文 |
| `mobile.spec.ts` | 手機的共同結構（#255，`docs/design.md`「手機與平板」）：390×844 時頂端列 60px（客戶名稱、身分徽章、兩個標示）、底部分頁列 72px、不顯示左側導覽；一般員工是首頁、問答、圖譜、時間軸、上傳，主管是首頁、問答、圖譜、上傳、更多（時間軸、待審，`tools=evals` 時加評測台）；底部面板的關閉按鈕、Esc、往下拖曳都會關閉，開啟時焦點在面板內、關閉後回到觸發的元件；展示模式登入後只有展示模式頂端列的分段切換；身分與語言面板的身分單選卡（附 `access.json` 的 `roles[].scope`）、語言的分段切換與「更換邀請碼」，帳號登入時只顯示帳號與角色、按鈕是「登出」；600／601／1024／1025px 的斷點（手機、平板、桌機）；觸控目標至少 44px、沒有橫向捲動 |
| `tablet.spec.ts` | 平板（#255，`docs/design.md`「平板」）：820×1180 時左側導覽列 72px、頁籤 60×56px、`nav` 有 `aria-label`，不顯示左側導覽與手機的分頁列；主管的所有頁籤（含待審與評測台）都在導覽列；身分的頭像打開身分與語言面板，原文（點引用標號）與圖譜的實體從右側滑出（貼齊右緣、全高、最寬 420px／400px），開啟時焦點在面板內，Esc 與關閉按鈕關閉、焦點回到觸發的元件；沒有橫向捲動。向右滑的手感與 safe area 由人在實機確認 |
| `entry-touch.spec.ts` | 入口（手機）與觸控目標（#255 PR 4，`docs/design.md`「手機與平板」「入口（手機）」）：390×844 時入口的主視覺在上、高 330px，前景節點數減半、遠景不模糊；820×1180 的登入頁沿用手機版、維持完整的前景；兩種寬度的輸入框與按鈕高 52px、文字連結 44px；頂端列、分頁列、「更多」、平板導覽列與身分與語言面板的按鈕與欄位高至少 44px；沒有橫向捲動。safe area 由人在實機確認 |
| `mobile-qa.spec.ts` | 手機的問答與原文面板（#256，`docs/design.md`「問答（手機）」）：390×844 時依序以預設問題的身分提問，找到檢索到至少 2 段的一題（假的回答引用 prompt 中的每一段，共 M 段；三份資料都找不到時 skip）；點引用標號後原文從底部面板升起（高 74%、貼齊視窗底部），標題是「原文 · 出處 1／M」，原文紙面與螢光的計算後顏色等於 `reading`、`markReading`；上一個、下一個至少 44px，第一個停用；按下一個後標題變成「原文 · 出處 2／M」、第二個標號為選取狀態、螢光換段；按關閉（焦點回到標號）與往下拖都會關閉；「回報有錯」關閉面板並展開該題的回報表單；每一步都沒有橫向捲動 |
| `mobile-entry-design.spec.ts` | 手機的登入與「使用邀請碼體驗」對齊設計稿（#355，畫板 `K-Mobile`）：390×844 時登入前沒有頂端列、分頁列與身分徽章（展示模式也一樣），登入後（帳號登入、以邀請碼體驗）照舊；帳號登入的主視覺在上、高 330px，左上是產品名稱與「虛構資料」，「展示用權限」不顯示；面板是 `surface` 底、表單不是卡片、標題 22px，不顯示「SIGN IN」與「或」；帳號單選列至少 46px、mono、選中的列 `primary` 框；密碼欄停用、虛線、placeholder 是「展示版不需要密碼」；使用邀請碼體驗沒有主視覺，「ACCESS」、標題 24px（切換後取得焦點）、mono 17px 的邀請碼欄，「開始使用」與「返回帳號登入」在下方、第一個畫面內；輸入框與按鈕高 52px、文字按鈕 44px；英文介面（在桌機切換後縮到手機寬度）不破版；沒有橫向捲動，截圖附在測試報告 |
| `mobile-qa-design.spec.ts` | 手機的問答與原文面板對齊設計稿（#354，畫板 `G-Mobile-QA`）：390×844 時以 `support/citing-answer.ts` 找到檢索到至少 2 段的一題（找不到時 skip）；問題是右緣與回答卡片對齊的泡泡（`text` 底、`surface` 字），卡片是 `surface` 底、有「根據 N 段原文回答」、本文 16px、引用標號 `markSoft` 底；輸入列是單行的 `input`、「提問」在框內、底邊貼齊分頁列、Enter 送出後清空，預設問題一行、沒有情境角色的標籤；「這次的問題（N）」與頂部的說明保留；輸入區、「回答提到」與原文面板的按鈕至少 44px；超過 500 字時邊線是 `danger`；原文面板的標題是 `textMuted` 的「原文 · 出處 1／M」、關閉在標題列、未引用的段落是 `textMuted`（Dark 是 `readingText`；只看得到引用段落時略過）、下方按鈕並排且高 48px、Esc 關閉；英文介面不破版；每一步沒有橫向捲動，截圖附在測試報告 |
| `sidebar.spec.ts` | 桌機的左側欄（#330，畫板 `K-Home`）：1440×900 時左側欄寬 220px、頁面項目高 44px、選中項目的背景色與文字色等於 `text`／`surface` token、沒有橫向捲動、「這次的問題」不在左側欄；邀請碼體驗的使用者卡（角色、「看得到：…」）打開身分與語言選單（身分單選卡、語言、「更換邀請碼」，在左側欄旁），Esc 關閉後焦點回到使用者卡；頁面項目與使用者卡都能用 Tab 到達；帳號登入的使用者卡（帳號、角色、「看得到：…」、「登出」），選單只有語言與「登出」；登入頁沒有使用者卡；英文介面左側欄不破版 |
| `qa-desktop.spec.ts` | 桌機的問答頁（#335，畫板 `QA`）：1440×900 時以 `support/citing-answer.ts` 找到檢索到至少 2 段的一題（找不到時 skip）；頁首 h1 28px 與說明、回答卡片最寬 760px、問題是右緣與卡片對齊的泡泡（`text` 底、`surface` 字）、「根據 N 段原文回答」的 N、本文 17px；輸入列是單行的 `input`、「提問」在框內、Enter 送出後清空；超過 500 字時邊線是 `danger`、停用提問；點引用標號後原文欄貼齊右緣與上下緣、寬 360～440px，「原文 · 出處 1」、`¶1`、「這次回答的出處」有 M 列（至少 44px），點第二列換成「出處 2」；✕ 關閉後焦點回到引用標號；英文介面不破版；每一步沒有橫向捲動，截圖附在測試報告 |
| `qa-desktop-states.spec.ts` | 桌機問答頁的狀態（#335 PR 2，畫板 `K-Answer`、`I-States`）：1440×900；拒答在回答卡片內、沒有虛線框，「可以試試」的下一步（上傳以外）是 `surfaceRaised` 底、有小標的卡片，三張以內在同一列；連不到伺服器時錯誤在回答卡片內，有圖示與「問題已保留…」，「重新提問」與訊息左緣對齊；今天用完了的說明條是 `surfaceRaised` 底、在輸入列上方；需要管理者的說明是 `conflictSoft` 底、`conflictText` 字；「回報有錯」高 36px、圓角 8px、`surface` 底；沒有橫向捲動，截圖附在測試報告 |
| `english-layout.spec.ts` | 英文版面（#288，`docs/design.md`「英文版面」）：以能審查的身分切到英文，375px 與 1440px 寬度下首頁、問答、圖譜、時間軸、上傳、待審都沒有橫向捲動，截圖附在測試報告；圖譜節點名稱最多兩行；待審頁分頁列超出時才有右側漸層提示（`has-more`）；客戶沒有英文時略過 |
| `mentions.spec.ts` | 「回答提到」與實體面板（#195）：假的回答寫出所有實體的名稱並引用 prompt 中每一段；點列出的實體後，右側面板顯示名稱、鄰近圖的畫布、關係清單（點了切換中心），「接著問」填進輸入框而不送出，「在圖譜中查看」切到圖譜頁並從該實體開始展開（#199）；以鄰近圖上的位置點一次相連的節點（不重試），面板改以它為中心，在新的面板再點一次；同一題在看得最多的身分與另一個身分下列出的實體不同，且都只列該身分看得到的實體（以 `oracle.ts` 算出） |
| `graph.spec.ts` | 圖譜的逐步展開（#199）：以看得最多的身分點一個節點，只有它與直接相連的節點不變灰；再點相連的節點，路徑累積（「已展開：A → B」）、聚焦集合擴大；點路徑的一段回到該層；「只看它」；「回到全部」後沒有變灰與選取。另一項不捲動：點第一個節點、等畫面移動結束，再點一次相連的節點，確認「已展開」那一列出現後畫布沒有移動、選取的是該節點。節點以 cytoscape 的實例取得位置後以滑鼠點一次，不重試（重試會遮住座標偏移，`support/graph.ts`） |
| `graph-scale.spec.ts` | 大量節點時的圖譜（#254）：E2E 只用客戶自己的資料（#254 決定 4）。每個身分以 oracle 算出看得到的圖，再套用與 app 相同的 `scaleMode()`／`clusterGraph()`：門檻以下畫出看得到的全部節點、沒有層級麵包屑（門檻以上從全覽開始）；清單模式的群組（`h3`）依序等於分群的群組名稱（同名的消歧名稱不比對，「其他」用 `client/i18n/`），每個看得到的實體正好列一次，看不到的實體名稱不成為群組名稱（#247）。門檻以上的三層導覽以單元測試與 `app/tests/fixtures/large-graph.ts` 驗證 |
| `upload-desktop.spec.ts` | 桌機的上傳頁（#344，畫板 `K-Uploads`、`B-Ingest`）：1440×900 時 h1 28px 與分段切換在同一列、內容寬於 960px、提示是 `surfaceRaised` 底；貼上含假萃取實體的文字送出後，進度卡「已送出〈標題〉」有四步（目前「等主管審核」是 `primary`，之前是 `success`）；「我的上傳 1」；列是 `surfaceRaised` 底、圓角 12px、日期 12px、審核中的膠囊是 `primary` 字；點一列在右側打開上傳詳情（貼齊右緣），「看原文」的實體有類型色的 3px 底線；英文介面不破版；沒有橫向捲動，截圖附在測試報告 |
| `graph-desktop.spec.ts` | 桌機的圖譜（#336，畫板 `Graph`、`G-Scale`）：1440×900 時畫布至少 720px 高、沒有選取時沒有實體欄、以搜尋選取後實體欄貼齊右緣且是整個高度、相關實體的列至少 52px、點列的右端也從它展開、放大／縮小按鈕改變縮放、沒有橫向捲動；英文介面不破版；截圖附在報告（`graph-1440px.png`、`graph-en-1440px.png`） |
| `evals-desktop.spec.ts` | 桌機的評測台與品質報告（#347，畫板 `F-Evals`、`J-Report`）：1440×900 時有 h1，按鈕列是同一列的三個按鈕（開始評測、下載 JSON、下載品質報告），評測前只有開始評測能按；跑完評測後總覽是表格（四項指標）、不留進度格，點一列在下方展開；「下載品質報告」直接用這次的結果產生，HTML 有兩個以上的 `section.page` 與每頁的「第 N／M 頁」；截圖附在報告（`evals-1440px.png`、`quality-report.png`） |
| `timeline-desktop.spec.ts` | 桌機的時間軸（#346，畫板 `F-Timeline`）：1440×900 時有 h1 與範圍（文件數等於畫面上的文件數），日期欄是 `MM-DD`、年份是分組標題，每一列都是卡片、頁面中沒有虛線框（鎖頭框不實作，#247）；篩選是一列，依實體篩選後不相關的卡片 45% 不透明、不移除；卡片預設精簡，展開後才有「打開原文」；沒有橫向捲動，截圖附在報告（`timeline-1440px.png`、`timeline-filtered-1440px.png`）。平板（820px）沒有頁首與展開按鈕，段落照舊直接列出。英文的 1440px 在 `english-layout.spec.ts` |
| `graph-search.spec.ts` | 圖譜的找起點與右側面板（#199）：沒有選取時桌機沒有實體欄（畫布佔滿寬度，#336）；以搜尋框選一個實體開始展開，在面板的關係清單點相連的實體展開第二層，「回到全部」後沒有變灰；一般身分搜尋不到只有能審查的身分看得到的實體，切回能審查的身分後搜得到；「在問答中問」切到問答頁、問句填進輸入框且沒有送出；實體面板有類型徽章，「在問答中問」是主要按鈕、「只看它」是次要按鈕，桌機的出現的文件是 `surfaceRaised` 卡片（#336），片段中出現的實體名稱以 `<mark>` 標出（#240）；類型篩選取消勾選後該類型變灰、搜尋不到；頁首的「找路徑」打開面板（`aria-expanded`），多跳路徑的起點預設為選取的實體、終點以搜尋選擇；手機寬度可以搜尋與展開、沒有橫向捲動。不點畫布 |
| `home.spec.ts` | 首頁（#283）：登入後先到首頁，問候是三種之一且不含身分名稱，常見問題只列目前身分的情境；從首頁提問切到問答頁，問過的問題列在首頁，「再問一次」成為新的一題；「等你處理」只給能審核的身分；「有更新」（#284）：能上傳、不能審核的身分上傳後是審核中，「查看進度」到我的上傳並選取該份，能審核的身分核准後是已核准，「在圖譜中查看」打開核准的實體；桌機 1440×900（#331，畫板 `K-Home`）：一般員工與主管各一張截圖附在報告，卡片兩欄、提問框與「提問」高 52px、卡片的列至少 52px、沒有橫向捲動、可見範圍不在首頁，提問框按 Enter 送出到問答頁，問過的問題顯示相對的提問時間。回報已處理的「看處理結果」見 `reports.spec.ts`。其他測試的 `openApp()` 登入後切到問答頁 |
| `home-mobile.spec.ts` | 手機的首頁（#356，畫板 `K-Mobile`）：390×844 時一般員工與主管各一張截圖附在報告；提問框是單行的 `input`、「提問」在框內、常見問題在下方，不顯示可見範圍；主管有兩張數字卡與在提問框上方的「開始審核」（沒有待審時是空狀態），一般員工有「有更新」；首頁的按鈕至少 44px、沒有橫向捲動；Enter 送出到問答頁，回到首頁後問過的問題整行是「再問一次」；英文介面不破版（截圖附在報告） |
| `presentation.spec.ts` | 客戶展示模式（#129，`/?mode=presentation`）：每個身分都只有問答與圖譜兩個頁籤（同時帶 `?tools=evals` 也一樣）；問答附出處並打開原文、圖譜畫出畫布；1920×1080 時照畫板 `H-QA`、`H-Graph`（#349：問題泡泡是 `text` 底、劇本有編號、原文是浮動卡片且 Esc 關閉後焦點回到引用標號、圖譜沒有搜尋框與找路徑、右側卡片的關聯列、`/` 不作用、沒有橫向捲動，截圖附在報告） |
| `compare.spec.ts` | 展示模式的身分對照（#261，需要 `VITE_DEMO_COMPARE=1` 的 build，見下方「本機執行」）：頂端列的按鈕開關對照，沒有題目時是說明；對照打開時點劇本中只有一個身分看得到答案段落的題目（以 `oracle.ts` 算出；沒有時略過），每個身分一欄、依 `access.json` 的順序，只有目前身分的欄是 `is-current`；假的 `/api/ask` 只在送出的段落含答案段落時回答（比對答案段落中第一段其他段落都不含的 20 字，不用開頭：開頭可能與看得到的段落相同；另有不需要瀏覽器與開關的測試確認比對文字只出現在一個答案段落），所以看得到的身分的欄有引用，其他欄是一般的拒答與「可以試試」，每一欄都不出現該身分看不到的段落；`C` 打開與關閉、`Esc` 關閉，焦點在輸入框時 `C` 是文字；1920×1080 時照畫板 `H-QA`（#349：題目泡泡、欄內的回答不是卡片、各欄等高、對照時沒有輸入區、沒有橫向捲動，截圖附在報告）；減少動態效果時欄的動畫時間是 0 |
| `demo.spec.ts` | 線上 demo 的設定（#100，只在 `VITE_ONLINE_DEMO=1` 的 build 執行，見下方「線上 demo」）：公開試用碼預先填入並以它提問、問答與上傳頁的提醒、評測台隱藏（帶 `?tools=evals` 也一樣）而待審保留、上傳後萃取的實體出現在待審；以 `VITE_DEMO_COMPARE=1` build 時，展示模式也沒有身分對照（#261） |

- **看不到的段落**以 `app/src/evals/oracle.ts` 的 `expectedVisible()` 從選定客戶的 `data/` 算出（`e2e/support/dataset.ts`），不以畫面或資料庫的結果為準；畫面文字以每段開頭 20 個字元比對（空白先合併）。切換前先確認畫面上確實有看不到的段落，比對本身才有效。
- **串流中的回答**：`route.fulfill` 一次送出整個 body，做不出串流到一半的狀態，所以 `holdAskStream()` 在頁面內替換 `fetch`，由測試以 `pushAskStream()` 逐段送出。
- **上傳寫入中按 Esc**：PGlite 在主執行緒執行，寫入期間瀏覽器不處理按鍵，也無法從外部看到「上傳中」的狀態（放慢 CPU 或上傳 400 段的文字都試過，仍看不到）。所以測試在按下上傳後立刻按 Esc，確認寫入不中斷、時間軸只有一份上傳的文件，完成後 Esc 可以關閉視窗。

### 本機執行

第一次執行前先安裝 Chromium（macOS 不加 `--with-deps`），之後 build 再執行測試（`npm run test:e2e` 即 `npx playwright test`）：

```bash
npx playwright install chromium
VITE_DEMO_COMPARE=1 npm run build
VITE_DEMO_COMPARE=1 npm run test:e2e
```

`VITE_DEMO_COMPARE=1` 開啟展示模式的身分對照（#261，營運開關，預設關閉）：`compare.spec.ts` 的畫面測試只在 build 與測試都帶這個變數時執行，沒有時略過（參考情境不得略過，整次執行算失敗）。已有在 port 4173 執行中的預覽頁時直接使用（CI 中一律自己啟動）。修改 `app/` 或 `client/` 後要重新 `npm run build`。對客戶執行時，build 與測試都加上同一個 `KK_CLIENT=<名稱>`（由人執行）。

### 線上 demo

`playwright.config.ts` 依 `VITE_ONLINE_DEMO` 決定範圍：`1` 時只執行 `demo.spec.ts`，其他情況不執行它（一般 build 沒有 demo 的畫面，demo build 沒有評測台）。build 與測試要用同一組環境變數，`VITE_PUBLIC_ACCESS_CODE` 用任意虛構字串（沒有設定時 `demo.spec.ts` 直接失敗）：

```bash
VITE_ONLINE_DEMO=1 VITE_PUBLIC_ACCESS_CODE=e2e-public-code VITE_DEMO_COMPARE=1 npm run build
VITE_ONLINE_DEMO=1 VITE_PUBLIC_ACCESS_CODE=e2e-public-code VITE_DEMO_COMPARE=1 npm run test:e2e
```

測試後要跑一般的 e2e 時，先不帶 `VITE_ONLINE_DEMO` 與 `VITE_PUBLIC_ACCESS_CODE` 重新 `npm run build`。只用參考情境 `client/`（線上 demo 不放客戶）。

### CI

`.github/workflows/e2e.yml` 在每個 PR（目標 `main`）與 push 到 `main` 時執行（ADR 0010，取代 ADR 0004 的「只在 push 到 `main` 後執行」）；不列為分支保護的必要檢查。PR 的 E2E 結果就是審查時的判準：runner 不在本機啟動瀏覽器，PR 描述的「驗證」寫「E2E 以 PR 上的 `E2E` 結果為準」。要對其他分支執行時，用 `workflow_dispatch`：Actions → E2E → Run workflow，或 `gh workflow run e2e.yml --ref <分支>`。

- `concurrency`：同一個 PR 推新的 commit 時取消舊的執行；push 到 `main` 與手動執行每次各自一個群組（`run_id`），不會被取消。
- 觸發是 `pull_request`（不是 `pull_request_target`），fork 來的 PR 也只以唯讀的 token 執行，拿不到 secret；workflow 本來就不用 secret，所以 fork 的 PR 也能照常執行。

- `list` job 列出參考情境（`""`）與 `clients/` 底下的客戶（`scripts/check-clients.mjs` 的 `listClients()`），`playwright` job 以 matrix 對每一個各執行一格（`KK_CLIENT` 設為該名稱，build 後執行測試；`fail-fast: false`）。`playwright` 與 `demo` 兩個 job 都設 `VITE_DEMO_COMPARE=1`（#261）：一般 build 執行 `compare.spec.ts`，線上 demo 的 build 確認身分對照仍然關閉。
- `demo` job 以線上 demo 的設定（`VITE_ONLINE_DEMO=1`、虛構的 `VITE_PUBLIC_ACCESS_CODE`）build 參考情境，執行 `demo.spec.ts`；失敗時的 artifact 是 `playwright-online-demo`，成功時是 `playwright-report-online-demo`。
- 權限只有 `contents: read`，不使用任何 secret。
- PR 上失敗時：程式造成的失敗由決策中心貼修正要求；GitHub 端異常造成的失敗由決策中心重跑（[decision-center.md](workflow/decision-center.md) 第 4 節）。main 上失敗時由決策中心另開修正 Issue（workflow 不會自動開 Issue）。

### 查看 artifact

成功時 workflow 上傳名為 `playwright-report-<客戶>` 的 artifact（參考情境是 `playwright-report-client`；內容是 `playwright-report/`，保留 7 天）。附截圖的測試（例如 `english-layout.spec.ts`）不論成敗都能在 PR 上下載報告，以 `npx playwright show-report playwright-report` 查看截圖。

失敗時 workflow 上傳名為 `playwright-<客戶>` 的 artifact（參考情境是 `playwright-client`；內容是 `test-results/` 與 `playwright-report/`，保留 14 天）：

1. 在 Actions 的該次執行頁面最下方的 Artifacts 下載 `playwright-<客戶>`，解壓縮。
2. trace：`npx playwright show-trace test-results/<測試>/trace.zip`（逐步的畫面、網路與主控台紀錄）。
3. 報告：`npx playwright show-report playwright-report`；失敗的截圖也在 `test-results/<測試>/` 中。
