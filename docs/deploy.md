# 線上 demo 的部署

以參考情境 `client/` 運作、不用安裝就能試用的線上 demo（#100，RFC 0002 提案 5）。決策與取捨見 [ADR 0005](adr/0005-online-demo.md)。

- **部署、secret 的設定與回退一律由人執行**；agent 不部署、不設定 secret，也不保存任何帳號的登入狀態。
- merge 不會改變線上版本：沒有部署 workflow，線上版本只在人執行 `wrangler deploy` 時更新。

## 架構

| 項目 | 內容 |
| --- | --- |
| Worker | 一個 Worker 同時提供 `dist/` 的靜態檔與 `/api/*`（同站，不設 `ALLOWED_ORIGINS`） |
| 設定 | `wrangler.jsonc` 的 `env.demo`：Worker 名稱 `knowledge-kit-demo`、`workers_dev: true`、計數用的 Durable Object、非機密的變數 |
| 網址 | `https://knowledge-kit-demo.<帳號子網域>.workers.dev`（Cloudflare 提供的子網域，不買網域） |
| secret | `ANTHROPIC_API_KEY`、`ACCESS_CODES`（以 `wrangler secret put --env demo` 設定，不進 repo） |
| 網頁的 build | `VITE_ONLINE_DEMO=1`、`VITE_PUBLIC_ACCESS_CODE=<公開碼>`，只用 `client/`（[docs/qa.md](qa.md)「線上 demo」） |

本機 `npx wrangler dev`（不加 `--env`）照舊使用頂層設定與 `.dev.vars`，不受 `env.demo` 影響。

## 事前準備（第一次）

1. **Cloudflare 帳號**：免費方案即可。第一次使用 `workers.dev` 時，在主控台的 Workers & Pages 設定帳號子網域。
2. **Claude Console**：
   - 建立 demo 專用的 workspace 與 API 金鑰，與本機開發的金鑰分開。
   - 在該 workspace 設定**每月花費上限**（金額由人決定，算法見下方「費用上限」）。超過時上游回錯誤，Worker 回 `upstream_quota`，畫面顯示「模型服務的額度已用完」。
3. **邀請碼**（[worker/README.md](../worker/README.md)「secret 與變數」的格式；碼至少 8 個英數字元）：
   - `public` 組：一個公開碼，build 時預先填入畫面，等於公開。所有訪客共用這一個碼的 `DAILY_LIMIT`。
   - `invited` 組：給潛在客戶與夥伴的碼，向作者索取；需要時可再分組，以便個別停用。
   - 不得沿用 `.dev.vars.example` 的 `demo:EXAMPLE1`。
4. **次數上限**：確認 `wrangler.jsonc` 的 `env.demo.vars`（`DAILY_LIMIT`、`GLOBAL_DAILY_LIMIT`）。要改數值時先開 PR 修改，部署以 repo 的值為準。

## 部署步驟

指令區塊內不加 `#` 註解（macOS 的 zsh 預設不把互動輸入的 `#` 當註解，照著複製會出錯），說明一律寫在區塊外。

在乾淨的 `main`（與 `origin/main` 一致、沒有未 commit 的變更）上執行：

```bash
git switch main && git pull
npm ci
```

選用：執行與 CI 相同的檢查（CI 已在 main 上跑過）。

```bash
npm run check:client && npm test
```

1. build：只用 `client/`，所以清掉 `KK_CLIENT`。

   ```bash
   env -u KK_CLIENT VITE_ONLINE_DEMO=1 VITE_PUBLIC_ACCESS_CODE=<公開碼> npm run build
   ```

2. 登入並部署（第一次會建立 Worker 與 Durable Object）。

   ```bash
   npx wrangler login
   npx wrangler deploy --env demo
   ```

3. secret（第一次，或要更換時）：值由人在提示中輸入，不寫進指令列或檔案。`ACCESS_CODES` 的格式例如 `public:<公開碼>;invited:<碼>,<碼>`。

   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY --env demo
   npx wrangler secret put ACCESS_CODES --env demo
   ```

- 第一次部署到設定 secret 之間，`/api/ask` 回 500 `misconfigured`，不會呼叫上游。
- `wrangler secret put` 會立即產生新版本，不需要再 deploy。
- 部署前可用 `npx wrangler deploy --env demo --dry-run` 確認綁定與變數（不需登入、不會上傳）。
- build 時忘了 `VITE_ONLINE_DEMO=1` 會部署出網址帶 `?tools=evals` 就有評測台、沒有預先填碼的版本：用下方的驗收清單確認，錯了就重新 build 與部署。

## 部署後的驗收清單

以訪客的身分（無痕視窗）確認：

- [ ] `https://knowledge-kit-demo.<帳號子網域>.workers.dev/api/health` 回 `{"ok":true}`
- [ ] 工具列有「虛構資料」「展示用權限」；邀請碼表單已填入公開碼，並說明所有訪客共用每日次數
- [ ] 問一題預設問題，得到附引用的回答；問答頁有「請勿輸入個人或機密資料」的提醒
- [ ] 沒有「評測台」頁籤（網址加上 `?tools=evals` 也沒有）；「上傳」「待審」可用，上傳頁有內容會傳給模型供應商的提醒
- [ ] 全站上限的畫面：在 Cloudflare 主控台把 `GLOBAL_DAILY_LIMIT` 暫時改為 `1`（Workers & Pages → `knowledge-kit-demo` → Settings → Variables and Secrets），再問一題，看到「今天的線上試用額度已用完」；之後以 `npx wrangler deploy --env demo` 恢復 repo 的值（計數不會歸零，當天已用的次數照算）
- [ ] Claude Console 的用量出現在 demo 專用的 workspace

## 更新

- **新版本**：重複「部署步驟」的 1、2（secret 沿用）。部署後再跑一次驗收清單。
- **更換公開碼**：先 `wrangler secret put ACCESS_CODES --env demo`，再用新碼重新 build 與部署。兩步之間，舊畫面的訪客會收到 `invalid_access_code`，回到邀請碼表單（不再預先填入），可以手動輸入新碼。
- **調整次數上限**：開 PR 修改 `env.demo.vars`，合併後部署。

## 回退與緊急停止

依影響由小到大：

| 情況 | 做法 | 生效 |
| --- | --- | --- |
| 新版本有問題 | `npx wrangler deployments list --env demo` 找到前一版，`npx wrangler rollback <版本 id> --env demo -m "<理由>"`（不給 id 時回到前一版） | 立即 |
| 公開碼被濫用 | 主控台把 `DISABLED_GROUPS` 改為 `public`：公開碼回 401，不呼叫上游；`invited` 照常 | 立即 |
| 要停止所有模型呼叫 | `DISABLED_GROUPS` 改為 `public,invited`（列出所有組） | 立即 |
| 要整個下線 | 主控台關閉 `workers.dev` 的路由，或 `npx wrangler delete --env demo`（刪除 Worker、secret 與計數） | 立即 |
| 以上都做不到 | 在 Claude Console 停用 demo 的 API 金鑰 | 立即；之後 `/api/ask` 回 `upstream_error` |

- 在主控台改的變數會被下一次 `wrangler deploy` 換回 repo 的值。要長期停用某組時，開 PR 修改 `env.demo.vars.DISABLED_GROUPS`。
- 回退後重新跑一次驗收清單。演練一次 `wrangler rollback` 列在 #100 的人工待辦。

## 費用上限

兩層上限，任一層擋住就不再產生費用：

1. **Worker 的次數上限**（`env.demo.vars`）：每個碼每日 `DAILY_LIMIT` 次，全站（所有碼合計）每日 `GLOBAL_DAILY_LIMIT` 次，以 UTC 換日。超過時回 429，不呼叫上游（[worker/README.md](../worker/README.md)）。
2. **Claude Console 的每月花費上限**：即使 Worker 的設定錯誤，費用也不會超過這個金額。

### 會呼叫模型的操作

每次呼叫都計入一次每個碼與全站的次數，所以每日的呼叫次數不會超過 `GLOBAL_DAILY_LIMIT`，與操作的組合無關。

| 操作 | 呼叫次數 |
| --- | --- |
| 問答一題 | 1；本機拒答（找不到段落）時 0 |
| 上傳一份文件 | 萃取每批 1 次，最多 `client/client.json` 的 `upload.extractMaxBatches` 批（參考情境為 3）＋說法不同的比對 1 次（`conflicts.enabled`；沒有要比對的段落時 0）。參考情境最多 4 次 |
| 重試萃取、重試比對 | 只重送失敗或未執行的批次，每批 1 次 |
| 評測台 | 線上 demo 隱藏 |

### 估算方式

金額由人代入 Claude Console 的價格（每 token 的輸入單價 `P_in`、輸出單價 `P_out`）計算：

- **單次最壞**：`C_max ≈ MAX_PROMPT_CHARS × P_in + 8,000 × P_out`
  - 輸入以「1 字元 ≈ 1 token」估算（中文約 1 字 1 token，英文約 4 字元 1 token，取較大者）。
  - 輸出是 `standard` 的 `max_tokens`（8,000，含 thinking；[worker/README.md](../worker/README.md)「模型白名單」）。
- **每日最壞**：`GLOBAL_DAILY_LIMIT × C_max`；**每月最壞**：每日 × 31。
- **一般情況**：各操作的 token 數見 [docs/qa.md](qa.md)「費用估算」、[docs/extraction.md](extraction.md)「費用估算」、[docs/conflicts.md](conflicts.md)「費用估算」；上線後以 Console 的實際用量修正。
- Console 的每月上限設在人可以接受的金額。低於「每月最壞」時，月底前可能先碰到 Console 的上限（訪客看到 `upstream_quota`），這是預期的行為。

Cloudflare 端以免費方案運作；Workers 與 Durable Objects 的免費額度用完時，`/api/ask` 回 503 `limit_unavailable`（[worker/README.md](../worker/README.md)「已知限制」）。

## 監控

不加外部監控（ADR 0005）。需要時由人查看：

- **Cloudflare 主控台**：`knowledge-kit-demo` 的請求數與錯誤率。
- **即時 log**：`npx wrangler tail --env demo`。每次請求一行 JSON（`event`、`status`、`error`、`group` 等），不含金鑰、邀請碼與提示全文。
- **Claude Console**：demo workspace 的用量與花費。

## 限制

- 拿到碼的人可以用 curl 偽造 `Origin` 直接呼叫 `/api/ask`，也能把呼叫用在問答以外的用途；費用由上面的兩層上限擋住。
- 公開碼等於公開：任何人都能在一天內用完公開碼的 `DAILY_LIMIT`，或全站的 `GLOBAL_DAILY_LIMIT`，其他訪客當天就不能用。不以 IP 計數；需要時由人在 Cloudflare 加 rate limiting 規則（選用）。
- 上傳的文件與核准結果只存在訪客的瀏覽器（記憶體資料庫），重新整理即消失；伺服器端不保存資料。
