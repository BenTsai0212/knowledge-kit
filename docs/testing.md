# 測試與 CI 的檢查

單元測試、型別檢查與 build 的指令見 [AGENTS.md](../AGENTS.md) 第 2 節。本文件說明 #66 加入的敏感資料檢查；套件與執行檔的來源見 [ADR 0004](adr/0004-e2e-and-secret-scanning.md)。

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
