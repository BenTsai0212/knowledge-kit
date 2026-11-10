# 測試與 CI 的檢查

單元測試、型別檢查與 build 的指令見 [AGENTS.md](../AGENTS.md) 第 2 節。本文件說明 CI 的 job、#66 加入的敏感資料檢查與 Playwright；套件與執行檔的來源見 [ADR 0004](adr/0004-e2e-and-secret-scanning.md)。

## CI 的 job

| workflow | job | 內容 | 什麼時候執行 |
| --- | --- | --- | --- |
| `workflows/ci.yml` | `checks` | 依序執行 `npm ci` → 確認沒有下載 CUDA → `npm run check:client` → `npm run typecheck` → `npm test` → `npm run build` → workflow 工具測試（`npm test --prefix tools/workflow`） | 每個 PR 與 push 到 `main` |
| `workflows/ci.yml` | `clients` | `npm run check:clients`（[docs/client-config.md](client-config.md)「客戶檢查」） | 每個 PR 與 push 到 `main` |
| `workflows/pr-body.yml` | `pr-body` | PR 描述要連到 Issue（`tools/workflow/check-pr-body.mjs`，見 [tools/workflow/README.md](../tools/workflow/README.md)） | PR 開啟、編輯、更新與標籤變更 |
| `workflows/sensitive.yml` | `sensitive-names`、`gitleaks` | 見下方[敏感資料檢查](#敏感資料檢查) | 每個 PR 與 push 到 `main`；手動觸發時掃描整段歷史 |
| `workflows/e2e.yml` | `list`、`playwright`、`demo` | 見下方 [Playwright](#playwright) 的「CI」 | 只在 push 到 `main` 後，另可手動執行 |

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
| `layout.spec.ts` | 問答頁的三欄版面（#195）：1280×720 的第一個畫面看得到輸入框、最新一題的回答與右側的原文面板，整頁不捲動；問答往下累積、輸入框位置不變、同一題問兩次送出的內容相同（不帶上一題）、「這次的問題」列出兩題，切換身分時清除；串流中停用送出與預設問題；手機寬度（390×844）上下堆疊、沒有橫向捲動、可以提問並看到原文 |
| `mentions.spec.ts` | 「回答提到」與實體面板（#195）：假的回答寫出所有實體的名稱並引用 prompt 中每一段；點列出的實體後，右側面板顯示名稱、鄰近圖的畫布、關係清單（點了切換中心），「接著問」填進輸入框而不送出，「在圖譜中查看」切到圖譜頁並從該實體開始展開（#199）；以鄰近圖上的位置點一次相連的節點（不重試），面板改以它為中心，在新的面板再點一次；同一題在看得最多的身分與另一個身分下列出的實體不同，且都只列該身分看得到的實體（以 `oracle.ts` 算出） |
| `graph.spec.ts` | 圖譜的逐步展開（#199）：以看得最多的身分點一個節點，只有它與直接相連的節點不變灰；再點相連的節點，路徑累積（「已展開：A → B」）、聚焦集合擴大；點路徑的一段回到該層；「只看它」；「回到全部」後沒有變灰與選取。另一項不捲動：點第一個節點、等畫面移動結束，再點一次相連的節點，確認「已展開」那一列出現後畫布沒有移動、選取的是該節點。節點以 cytoscape 的實例取得位置後以滑鼠點一次，不重試（重試會遮住座標偏移，`support/graph.ts`） |
| `graph-search.spec.ts` | 圖譜的找起點與右側面板（#199）：沒有選取時右側列出「關聯最多」；以搜尋框選一個實體開始展開，在面板的關係清單點相連的實體展開第二層，「回到全部」後沒有變灰；一般身分搜尋不到只有能審查的身分看得到的實體，切回能審查的身分後搜得到；「在問答中問」切到問答頁、問句填進輸入框且沒有送出；類型篩選取消勾選後該類型變灰、搜尋不到；多跳路徑的起點預設為選取的實體、終點以搜尋選擇；手機寬度可以搜尋與展開、沒有橫向捲動。不點畫布 |
| `presentation.spec.ts` | 客戶展示模式（#129，`/?mode=presentation`）：每個身分都只有問答與圖譜兩個頁籤（同時帶 `?tools=evals` 也一樣）；問答附出處並打開原文、圖譜畫出畫布 |
| `demo.spec.ts` | 線上 demo 的設定（#100，只在 `VITE_ONLINE_DEMO=1` 的 build 執行，見下方「線上 demo」）：公開試用碼預先填入並以它提問、問答與上傳頁的提醒、評測台隱藏（帶 `?tools=evals` 也一樣）而待審保留、上傳後萃取的實體出現在待審 |

- **看不到的段落**以 `app/src/evals/oracle.ts` 的 `expectedVisible()` 從選定客戶的 `data/` 算出（`e2e/support/dataset.ts`），不以畫面或資料庫的結果為準；畫面文字以每段開頭 20 個字元比對（空白先合併）。切換前先確認畫面上確實有看不到的段落，比對本身才有效。
- **串流中的回答**：`route.fulfill` 一次送出整個 body，做不出串流到一半的狀態，所以 `holdAskStream()` 在頁面內替換 `fetch`，由測試以 `pushAskStream()` 逐段送出。
- **上傳寫入中按 Esc**：PGlite 在主執行緒執行，寫入期間瀏覽器不處理按鍵，也無法從外部看到「上傳中」的狀態（放慢 CPU 或上傳 400 段的文字都試過，仍看不到）。所以測試在按下上傳後立刻按 Esc，確認寫入不中斷、時間軸只有一份上傳的文件，完成後 Esc 可以關閉視窗。

### 本機執行

第一次執行前先安裝 Chromium（macOS 不加 `--with-deps`），之後 build 再執行測試（`npm run test:e2e` 即 `npx playwright test`）：

```bash
npx playwright install chromium
npm run build
npm run test:e2e
```

已有在 port 4173 執行中的預覽頁時直接使用（CI 中一律自己啟動）。修改 `app/` 或 `client/` 後要重新 `npm run build`。對客戶執行時，build 與測試都加上同一個 `KK_CLIENT=<名稱>`（由人執行）。

### 線上 demo

`playwright.config.ts` 依 `VITE_ONLINE_DEMO` 決定範圍：`1` 時只執行 `demo.spec.ts`，其他情況不執行它（一般 build 沒有 demo 的畫面，demo build 沒有評測台）。build 與測試要用同一組環境變數，`VITE_PUBLIC_ACCESS_CODE` 用任意虛構字串（沒有設定時 `demo.spec.ts` 直接失敗）：

```bash
VITE_ONLINE_DEMO=1 VITE_PUBLIC_ACCESS_CODE=e2e-public-code npm run build
VITE_ONLINE_DEMO=1 VITE_PUBLIC_ACCESS_CODE=e2e-public-code npm run test:e2e
```

測試後要跑一般的 e2e 時，先不帶這兩個變數重新 `npm run build`。只用參考情境 `client/`（線上 demo 不放客戶）。

### CI

`.github/workflows/e2e.yml` 只在 push 到 `main` 後執行，不在 PR 執行（ADR 0004）。要對分支執行時，用 `workflow_dispatch`：Actions → E2E → Run workflow，或 `gh workflow run e2e.yml --ref <分支>`。`workflow_dispatch` 只對預設分支上已有的 workflow 有效，所以 `e2e.yml` 合併到 `main` 之前無法手動執行。

- `list` job 列出參考情境（`""`）與 `clients/` 底下的客戶（`scripts/check-clients.mjs` 的 `listClients()`），`playwright` job 以 matrix 對每一個各執行一格（`KK_CLIENT` 設為該名稱，build 後執行測試；`fail-fast: false`）。
- `demo` job 以線上 demo 的設定（`VITE_ONLINE_DEMO=1`、虛構的 `VITE_PUBLIC_ACCESS_CODE`）build 參考情境，執行 `demo.spec.ts`；失敗時的 artifact 是 `playwright-online-demo`。
- 權限只有 `contents: read`，不使用任何 secret。
- main 上失敗時由決策中心另開修正 Issue（workflow 不會自動開 Issue）。

### 失敗時查看 artifact

失敗時 workflow 上傳名為 `playwright-<客戶>` 的 artifact（參考情境是 `playwright-client`；內容是 `test-results/` 與 `playwright-report/`，保留 14 天）：

1. 在 Actions 的該次執行頁面最下方的 Artifacts 下載 `playwright-<客戶>`，解壓縮。
2. trace：`npx playwright show-trace test-results/<測試>/trace.zip`（逐步的畫面、網路與主控台紀錄）。
3. 報告：`npx playwright show-report playwright-report`；失敗的截圖也在 `test-results/<測試>/` 中。
