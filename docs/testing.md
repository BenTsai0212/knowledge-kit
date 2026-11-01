# 測試與 CI 的檢查

單元測試、型別檢查與 build 的指令見 [AGENTS.md](../AGENTS.md) 第 2 節。本文件說明 #66 加入的敏感資料檢查與 Playwright；套件與執行檔的來源見 [ADR 0004](adr/0004-e2e-and-secret-scanning.md)。

## 敏感資料檢查

`.github/workflows/sensitive.yml` 在每個 PR 與 push 到 `main` 時執行，分成兩個 job，任何一個失敗就擋下：

| job | 檢查 | 工具 |
| --- | --- | --- |
| `sensitive-names` | 個人 email、禁用名稱（客戶、合作夥伴等） | `scripts/check-sensitive.mjs`（自寫，不用套件） |
| `gitleaks` | 金鑰、token | gitleaks（固定版本＋SHA-256） |

repo 預計公開，CI 紀錄也會公開，所以兩者的輸出都**不包含命中的內容本身**：腳本只輸出檔案、行號與清單第幾項，gitleaks 以 `--redact` 遮蔽金鑰。

### `scripts/check-sensitive.mjs`

本機執行：`npm run check:sensitive`。

- 只掃 `git ls-files` 列出的檔案（尚未 `git add` 的新檔不在範圍內），略過含 NUL 位元組的二進位檔。
- **email**：以下放行，其他一律失敗。
  1. 帳號是 `noreply` 的地址，以及 `noreply.github.com` 與其子網域（GitHub 的 noreply 地址）。
  2. `example.com`、`example.org`、`example.net` 與其子網域（RFC 2606）。
  3. 頂級網域 `.test`、`.example`、`.invalid`、`.localhost`（RFC 2606／6761）。
  4. 資料集使用的虛構網域：腳本中的 `FICTIONAL_DOMAINS`，目前是空的。資料集加入虛構網域的 email 時一起修改。

  頂級網域不是英文字母的不算 email（例如 `pkg@1.2.3` 這類套件版本）。文件或範例需要 email 時，使用 `example.com` 等保留網域。
- **禁用名稱**：清單一行一項，`#` 開頭的行是註解。檔案的每一行與清單的每一項都先做 NFKC、轉小寫、去掉所有空白，再比對子字串，所以全形、大小寫不同、中間夾空白的寫法也會被擋。「第幾項」只算有效的項目（不含註解與空行）。

### 禁用名稱清單的設定

清單內容由人設定，agent 不讀取、不建立、不猜測內容。

- **CI**：repo secret `SENSITIVE_NAMES`（Settings → Secrets and variables → Actions），內容與本機清單檔相同的格式，一行一項。只在 `sensitive-names` job 執行腳本的 step 以環境變數傳入。
  - CI 中（`CI=true`）讀不到 secret 或內容沒有任何有效項目時，job 失敗並說明原因，不會默默通過。
  - GitHub 不提供 secret 給 fork 來的 PR，這類 PR 的 `sensitive-names` job 會失敗（ADR 0004）。
- **本機**：repo 根目錄的 `.sensitive-names.local`（已加進 `.gitignore`）。沒有這個檔案時，腳本顯示警告、略過名稱檢查，email 照常檢查。設定了環境變數 `SENSITIVE_NAMES` 時以環境變數為準。

### gitleaks

- 版本與 SHA-256 寫在 `sensitive.yml` 的 `GITLEAKS_VERSION`、`GITLEAKS_SHA256`。升級時依 ADR 0004 重新查證版本、檢查碼與 CVE，同時修改兩者與 ADR。
- 掃描範圍：PR 是 `base..head` 之間新增的 commit，push 到 `main` 是 `before..after`。不加自訂規則檔，也不加 allowlist。
- 每次執行前，先在 `$RUNNER_TEMP` 產生假的 GitHub token 與 AWS access key，確認 `gitleaks dir` 會擋下（反向驗證）；沒擋下時 job 失敗。假金鑰不寫進 repo。
- 整段 git 歷史的掃描由人在本機執行（安裝 gitleaks 是人的決定，見 AGENTS.md 第 6 節）：`gitleaks git --redact --exit-code 1`，在 repo 根目錄執行；結果記錄在 #66。

## Playwright

畫面層的端對端測試（`@playwright/test`，只用 Chromium）。測試在 `e2e/`，不在 Vitest 的範圍內，`npm test` 不會執行；型別檢查包含在 `npm run typecheck`（`e2e/tsconfig.json`）。

- 對 `npm run build` 產生的 `dist/` 執行：`playwright.config.ts` 的 `webServer` 以 `vite preview`（port 4173）提供預覽頁。
- `/api/ask` 一律由測試以 `page.route` 回傳假的 SSE（`e2e/support/fake-ask.ts`），依 `system` 的開頭分辨問答、萃取、比對與評分；不使用真實金鑰，也不啟動 Worker。不認得的請求回錯誤，測試因而失敗。
- 畫面文字一律從選定客戶的 `i18n/` 讀取（`e2e/support/app.ts`），只用預設語言；身分以 Toolbar 的選單切換。
- 不使用固定的等待時間，只靠 Playwright 的自動等待與會重試的斷言；資料庫是否載入完成，以預設問題的按鈕可以按為準。
- `workers: 1`（每個頁面在瀏覽器內建一個 PGlite）；CI 中失敗時重試 2 次，第一次重試時記錄 trace，失敗時保留截圖。
- `e2e/tsconfig.json` 加入 `vite/client` 的型別，因為測試匯入的 `app/src/evals/oracle.ts` 會連帶檢查使用 `import.meta.glob` 的檔案；沒有 `@types/node`，用到的 `node:fs` 與 `process.env` 在 `e2e/support/node-fs.d.ts` 自行宣告。

### 客戶（#77）

測試不寫死角色、等級、專案或實體類型，對參考情境 `client/` 與 `clients/<名稱>/` 都能執行。

- **選定客戶**：與 build 相同，以 `KK_CLIENT` 選擇（`scripts/client-dir.mjs` 的 `resolveClientDir()`）；`e2e/support/client.ts` 在 Node 端以 `fs` 讀取該客戶的 JSON。build 與測試要用同一個 `KK_CLIENT`。
- **身分**由 `access.json` 推算，都取可見等級 rank 最高者（同分時取較前面的）：能審查的身分（參考情境是 `manager`）、不能審查的身分（`staff`）、能上傳的身分、能上傳也能審查的身分。假萃取的實體類型是 `knowledge-model.json` 的第一個，名稱在 `client.languages` 的每種語言都相同。
- **前提不成立時略過**：例如沒有不能審查的身分、資料集中沒有某身分完全看不到的文件，該測試以 `test.skip(條件, 原因)` 略過。`e2e/support/skip-reporter.ts` 在輸出與 CI 的 job summary 列出略過的測試與原因；**參考情境不得有任何略過**，有的話整次執行算失敗（#77 決定 4）。

### 測試內容

| 檔案 | 內容 |
| --- | --- |
| `smoke.spec.ts` | 冒煙：問答附出處、圖譜、時間軸、上傳與待審、評測台能打開並完成基本操作 |
| `access.spec.ts` | 越權：打開原文後切換身分，原文面板與時間軸不殘留看不到的段落；串流回答中切換身分；待審與評測台只給 `canReview` 的身分；在評測台切換成沒有 `canReview` 的身分 |
| `interactions.spec.ts` | 互動邊角：上傳寫入中按 Esc；評測執行中離開頁籤再回來顯示「已停止」；深色模式（`emulateMedia`） |

- **看不到的段落**以 `app/src/evals/oracle.ts` 的 `expectedVisible()` 從選定客戶的 `data/` 算出（`e2e/support/dataset.ts`），不以畫面或資料庫的結果為準；畫面文字以每段開頭 20 個字元比對（空白先合併）。切換前先確認畫面上確實有看不到的段落，比對本身才有效。
- **串流中的回答**：`route.fulfill` 一次送出整個 body，做不出串流到一半的狀態，所以 `holdAskStream()` 在頁面內替換 `fetch`，由測試以 `pushAskStream()` 逐段送出。
- **上傳寫入中按 Esc**：PGlite 在主執行緒執行，寫入期間瀏覽器不處理按鍵，也無法從外部看到「上傳中」的狀態（放慢 CPU 或上傳 400 段的文字都試過，仍看不到）。所以測試在按下上傳後立刻按 Esc，確認寫入不中斷、時間軸只有一份上傳的文件，完成後 Esc 可以關閉視窗。

### 本機執行

```bash
npx playwright install chromium   # 第一次執行前；macOS 不加 --with-deps
npm run build
npm run test:e2e                  # 即 npx playwright test
```

已有在 port 4173 執行中的預覽頁時直接使用（CI 中一律自己啟動）。修改 `app/` 或 `client/` 後要重新 `npm run build`。對客戶執行時，build 與測試都加上同一個 `KK_CLIENT=<名稱>`（由人執行）。

### CI

`.github/workflows/e2e.yml` 只在 push 到 `main` 後執行，不在 PR 執行（ADR 0004）。要對分支執行時，用 `workflow_dispatch`：Actions → E2E → Run workflow，或 `gh workflow run e2e.yml --ref <分支>`。`workflow_dispatch` 只對預設分支上已有的 workflow 有效，所以 `e2e.yml` 合併到 `main` 之前無法手動執行。

- `list` job 列出參考情境（`""`）與 `clients/` 底下的客戶（`scripts/check-clients.mjs` 的 `listClients()`），`playwright` job 以 matrix 對每一個各執行一格（`KK_CLIENT` 設為該名稱，build 後執行測試；`fail-fast: false`）。
- 權限只有 `contents: read`，不使用任何 secret。
- main 上失敗時由決策中心另開修正 Issue（workflow 不會自動開 Issue）。

### 失敗時查看 artifact

失敗時 workflow 上傳名為 `playwright-<客戶>` 的 artifact（參考情境是 `playwright-client`；內容是 `test-results/` 與 `playwright-report/`，保留 14 天）：

1. 在 Actions 的該次執行頁面最下方的 Artifacts 下載 `playwright-<客戶>`，解壓縮。
2. trace：`npx playwright show-trace test-results/<測試>/trace.zip`（逐步的畫面、網路與主控台紀錄）。
3. 報告：`npx playwright show-report playwright-report`；失敗的截圖也在 `test-results/<測試>/` 中。
