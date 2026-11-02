# ADR 0005：線上 demo 的部署方式與費用上限

- 狀態：Proposed
- 日期：2026-11-02
- 決定者：@BenTsai0212
- 相關：#100（計畫與 `## 決定`）、RFC 0002 提案 5、Epic #93 第 7 項、ADR 0001（Cloudflare Worker）

## 背景

RFC 0002 提案 5 要求 v1 發表時附一個以參考情境運作、不用安裝就能試用的線上 demo，修訂了 RFC 0001「不做部署給外部使用者的參考網站」。

`/api/ask` 會呼叫付費的模型，而且同站檢查擋不住偽造 `Origin` 的 curl。所以費用上限只能靠邀請碼與次數上限，以及供應商端的花費上限。

## 選項

- **部署方式**
  1. 同一個 Worker 提供靜態檔與 `/api/*`，由人手動 `wrangler deploy`。
  2. 網頁另放 Pages：多一個服務，網頁與 API 跨站，要設 `ALLOWED_ORIGINS`。
  3. GitHub Actions 自動部署：需要新的 Cloudflare API token secret，merge 就會改變線上版本。
- **訪客的試用額度**
  - A. 公開一組共用的邀請碼：打開就能問，但任何人都能耗盡當日額度。
  - B. 向作者索取：濫用風險低，但要等回覆，多數訪客會離開。
  - C. 不需邀請碼、只限全站總量：與 A 的風險相同，Worker 還要新增「無碼」的路徑。
- **上傳與評測台**：全部開放、只開放問答與瀏覽，或只隱藏評測台。

## 決定

- **部署**：選項 1。設定在 `wrangler.jsonc` 的 `env.demo`（`knowledge-kit-demo`、`workers_dev`），網址用 Cloudflare 的子網域。部署、secret 與回退一律由人執行，步驟見 [docs/deploy.md](../deploy.md)。
- **試用額度**：A＋B 並用。
  - 公開碼放在 `ACCESS_CODES` 的 `public` 組，build 時以 `VITE_PUBLIC_ACCESS_CODE` 預先填入畫面。
  - 給潛在客戶與夥伴的碼放在 `invited` 組。
  - 不以 IP 計數：要保存 IP 的雜湊，會多出個資的考量。
- **費用上限**：兩層。
  - Worker：每個碼的 `DAILY_LIMIT`，加上新增的全站 `GLOBAL_DAILY_LIMIT`（未設定時不限制；超過時回 429 `global_daily_limit`，#103）。
  - 供應商：demo 專用的 Console workspace 與金鑰，設定每月花費上限（人工）。
- **畫面**：build 時的營運開關 `VITE_ONLINE_DEMO`（預設關閉，#105）。開啟時只隱藏評測台；上傳與待審保留，加上「內容會傳給模型供應商」的提醒。開關不放進 `client/`，客戶的 fork 不繼承 demo 的限制。
- **上線模組**（`docs/workflow/modules.md`）：只採用部分規則，不啟用整個模組。
  - 採用：回退流程寫成文件、部署後由人依清單確認、部署不由 agent 執行。
  - 不採用：`needs-setup` 標籤與 CI 防護。merge 不會改變線上版本，沒有「合併前需外部設定」的情況。
  - 不採用：外部監控。改看 Cloudflare 主控台、`wrangler tail` 與 Console 用量。
  - 理由：demo 只有虛構資料，沒有帳號，伺服器端也不保存資料。

## 後果

- **好處**：
  - 不需要新的 CI secret，也不新增外部服務。
  - 費用有兩層上限，Worker 設定錯誤時仍有供應商端的上限。
  - 本機開發（`wrangler dev`）與參考情境的行為不變。
- **代價**：
  - 公開碼被濫用時，當天其他訪客不能試用；被全站上限擋下時，該碼已扣的一次不退還。
  - 手動部署可能 build 錯設定，例如忘了 `VITE_ONLINE_DEMO=1`；靠部署後的驗收清單發現。
  - 在主控台改的變數會被下一次部署蓋掉，長期的變更要走 PR。
- **重新檢討的條件**：
  - 改成自動部署。
  - 有真實使用者或真實資料，例如給客戶的試用環境。
  - 濫用造成的停用超過偶發程度。
  - 以上任一成立時，重新評估啟用整個上線模組。
