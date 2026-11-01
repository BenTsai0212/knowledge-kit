# ADR 0004：Playwright 與 gitleaks

- 狀態：Proposed
- 日期：2026-11-01
- 決定者：@BenTsai0212
- 相關：#66（敏感資料檢查與 Playwright）、Epic #3 第 12 項、ADR 0001（核准的套件與偵測工具）

## 背景

#66 要在 CI 加上兩項檢查：

- **敏感資料檢查**：個人 email 與禁用名稱用自寫的 Node 腳本（不新增套件），金鑰交給 gitleaks。
- **Playwright**：畫面層的冒煙、越權與互動測試。

ADR 0001 已把 `@playwright/test` 列為核准的套件，但沒有記錄版本、安裝時會執行什麼、瀏覽器從哪裡下載。gitleaks 不是 npm 套件，也不在 ADR 0001 的清單內。#66 決定把兩者寫在同一份 ADR，查證實際執行的檔案，照原樣安裝執行，不另加參數。

以下數據由 agent 在 2026-11-01 查證（npm registry、GitHub API、`microsoft/playwright` 在 `v1.64.1` tag 的原始碼）。

## 選項

- **gitleaks 的取得方式**
  1. 固定版本的執行檔＋寫死在 workflow 裡的 SHA-256。
  2. 官方的 `gitleaks/gitleaks-action`：授權是自訂條款（GitHub 顯示 `NOASSERTION`），組織帳號需要授權金鑰，不採用。
- **Playwright 的瀏覽器**：只裝 Chromium（#66 決定），不裝 Firefox、WebKit。

## 決定

### `@playwright/test`（開發相依）

| 項目 | 查證結果 |
| --- | --- |
| 版本 | `1.64.1`（2026-10-14 發布，查證時的 `latest`），以 `package-lock.json` 鎖定 |
| 授權 | Apache-2.0（`@playwright/test`、`playwright`、`playwright-core` 三者相同） |
| 相依 | 只有 `@playwright/test` → `playwright` → `playwright-core` 一條鏈，三者版本相同；沒有 `optionalDependencies`，不帶入其他第三方套件 |
| 安裝腳本 | 三者都沒有 `preinstall`／`install`／`postinstall`（registry 的 `scripts` 為空，lockfile 沒有 `hasInstallScript`）。安裝套件時不下載瀏覽器 |
| 套件來源 | 三者在 npm registry 都附 provenance attestation，來源是 `github.com/microsoft/playwright` |
| `npm audit` | 只含這三個套件的 lockfile（`npm install --package-lock-only`）：0 vulnerabilities。加進本專案後在 PR 3 重跑，結果寫在 PR 描述 |
| 已知 CVE | GitHub Advisory Database 對 `1.64.1` 沒有任何公告。歷史上唯一一筆是 CVE-2025-59288（GHSA-7mvr-c777-76hp，下載瀏覽器時沒有驗證 TLS 憑證，`< 1.55.1`），本版本不受影響 |
| Node | `engines.node >= 20`，符合專案的 Node 22 |

**瀏覽器的下載**（`npx playwright install --with-deps chromium`，只在 CI 的 e2e workflow 與人本機執行）：

- 依 `packages/playwright-core/browsers.json` 與 `src/server/registry/index.ts`（`v1.64.1`），`chromium` 會安裝三項：
  - `chromium`：Chrome for Testing `156.0.8078.4`，`https://cdn.playwright.dev/builds/cft/156.0.8078.4/linux64/chrome-linux64.zip`
  - `chromium-headless-shell`：同版本，`…/linux64/chrome-headless-shell-linux64.zip`（同一個主機）
  - `ffmpeg`（revision `1013`，錄影用）：`builds/ffmpeg/1013/ffmpeg-linux.zip`，依序嘗試 `cdn.playwright.dev/dbazure/download/playwright`、`playwright.download.prss.microsoft.com/dbazure/download/playwright`、`cdn.playwright.dev`
- 只走 HTTPS，憑證驗證在 1.55.1 修正（上述 CVE）。**下載的 zip 沒有檢查碼比對**，完整性只靠 TLS 與 Microsoft 的 CDN；這是 Playwright 本身的作法，照原樣接受。
- `--with-deps` 在 Ubuntu runner 上以 `sudo apt-get install` 安裝瀏覽器需要的系統函式庫（套件來源是 runner 的 apt 來源）。人本機（macOS）只需 `npx playwright install chromium`，不加 `--with-deps`。
- 不設定 `PLAYWRIGHT_DOWNLOAD_HOST` 等環境變數，使用預設的下載來源。

### gitleaks（CI 執行檔，不進 `package.json`）

| 項目 | 查證結果 |
| --- | --- |
| 版本 | `v8.30.1`（2026-03-21 發布，查證時的最新版） |
| 授權 | MIT（`gitleaks/gitleaks`） |
| 執行檔 | `https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz`（8,230,402 bytes） |
| SHA-256 | `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` |
| 檢查碼的比對 | 兩個來源一致：GitHub release API 的 asset `digest`，與同一個 release 的 `gitleaks_8.30.1_checksums.txt` |
| 已知 CVE | GitHub Advisory Database 對 Go module `github.com/zricethezav/gitleaks/v8` 沒有任何公告 |
| 安裝腳本 | 不適用（單一 Go 執行檔，解壓即可執行） |
| provenance | release 沒有 GitHub artifact attestation，所以用寫死的 SHA-256 鎖定 |

- workflow 下載上述 tar.gz，以寫死在 workflow 裡的 SHA-256 執行 `sha256sum -c`，不信任同一次下載的 `checksums.txt`。升級時重新查證兩個來源，同時改版本與 SHA-256，並更新本 ADR 的表格（或新增 ADR）。
- 執行：`gitleaks git --log-opts="<base>..<head>" --redact --exit-code 1`。`--redact` 讓紀錄不出現命中的金鑰（#66 決定 2）；不加自訂規則檔，也不加 allowlist。
- 同一個 job 另外在 `$RUNNER_TEMP` 產生假金鑰並執行 `gitleaks dir`，要求它失敗，確認假金鑰會被擋（repo 中不放假金鑰字串）。

### 與 ADR 0001 的差異

ADR 0001 的「偵測工具」寫「全部進 CI」與「客戶名稱等黑名單放在不進版本控制的本機檔，CI 只檢查通用格式」。#66 的決定改為以下兩點，以本 ADR 為準：

- 禁用名稱清單在 CI 從 repo secret `SENSITIVE_NAMES` 讀取，讀不到時 CI 失敗。本機仍讀不進版本控制的檔案。
- Playwright 只在 push 到 `main` 後執行，另可用 `workflow_dispatch` 對分支手動執行，不在每個 PR 執行。

## 後果

- **好處**：畫面層的越權有自動測試；金鑰、個人 email、禁用名稱在 PR 階段就會被擋。gitleaks 以固定的檢查碼鎖定，不經第三方 Action。
- **代價**：
  - 每次 e2e workflow 都要下載 Chromium、headless shell 與 ffmpeg（實際大小與時間以 PR 3 的 CI 紀錄為準）。Playwright 不在 PR 執行，PR 的 CI 時間不受影響。
  - 瀏覽器 zip 沒有檢查碼比對（見上）。
  - fork 來的 PR 拿不到 secret，`sensitive-names` job 會失敗（#66 決定照此處理）。
  - gitleaks 與 Playwright 的升級都要人工查證：版本、檢查碼、CVE。
- **後續工作**：#66 PR 2（敏感資料檢查）、PR 3（Playwright 基礎與冒煙）、PR 4（越權與互動邊角）。本 ADR 經同意後才開始。
