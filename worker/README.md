# worker/

Cloudflare Worker（TypeScript）。提供 `dist/` 的靜態檔與以下 API：

| 路徑 | 內容 |
| --- | --- |
| `GET /api/health` | `{ "ok": true }` |
| `POST /api/ask` | 轉發到 Claude Messages API，以 SSE 串流回傳 |

`wrangler.jsonc` 只供本機開發，不含部署設定（routes、account_id、自訂網域）；部署方式另開 Issue 決定。

## `POST /api/ask`

### 請求

- Header `X-Access-Code`：邀請碼。
- Body：

  ```json
  { "model": "standard", "system": "（選填）", "messages": [{ "role": "user", "content": "問題" }] }
  ```

  - `model` 是白名單代號，不是實際的模型名稱。
  - `messages` 必須以 `user` 開始與結束，`content` 只接受字串。
  - 其他欄位（`max_tokens`、`tools`、`temperature` 等）一律丟棄。

Worker 依序檢查以下各項，任何一步失敗都直接回錯誤，不呼叫上游：
1. 同站
2. 邀請碼
3. body
4. 模型代號
5. 提示長度
6. 當日次數

檢查失敗的請求不計入次數。

### 回應

成功時回 `200 text/event-stream`，事件有三種：

| 事件 | 資料 | 說明 |
| --- | --- | --- |
| `delta` | `{ "text": "..." }` | 回答的文字片段，依序串接 |
| `done` | `{ "stopReason": "end_turn" }` | 正常結束；`stopReason` 沿用上游的 `stop_reason`（例如 `max_tokens` 表示被截斷） |
| `error` | `{ "type": "upstream_overloaded" }` | 串流中發生錯誤；之前已送出的 `delta` 可能是不完整的回答 |

`done` 與 `error` 之後串流就結束。模型的 thinking 不會轉送。

### 錯誤類型

串流開始前的錯誤回 JSON `{ "error": "<類型>" }`；串流中的錯誤以 `error` 事件回傳。

| 類型 | HTTP | 情況 |
| --- | --- | --- |
| `forbidden_origin` | 403 | 跨站或缺少 `Origin` |
| `invalid_access_code` | 401 | 沒有、錯誤或已停用的邀請碼（不區分原因） |
| `invalid_request` | 400 | body 格式錯誤 |
| `unknown_model` | 400 | 模型代號不在白名單 |
| `prompt_too_long` | 400 | `system` 與所有 `content` 的字元數合計超過 `MAX_PROMPT_CHARS` |
| `daily_limit` | 429 | 此邀請碼今日次數已滿 |
| `limit_unavailable` | 503 | 計數用的 Durable Object 無法使用（例如免費額度用完），此時不放行 |
| `misconfigured` | 500 | secret 或變數未設定或格式錯誤 |
| `method_not_allowed` | 405 | 不是 `POST` |
| `upstream_quota` | 502 | 上游 402、429，或花費上限（400，從訊息辨識） |
| `upstream_overloaded` | 503／串流內 | 上游 529，或串流中的 `overloaded_error` |
| `upstream_timeout` | 504 | 上游 504 |
| `upstream_error` | 502 | 其他上游錯誤（401 金鑰無效、403、500、連不到上游等） |
| `upstream_refusal` | 串流內 | `stop_reason: "refusal"` |
| `upstream_interrupted` | 串流內 | 串流中斷，或串流中的其他錯誤 |

上游的錯誤類型見 [Claude API errors](https://platform.claude.com/docs/en/api/errors)，串流格式見 [Streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming)。

### log

每次請求以 `console.log` 輸出一行 JSON，包含以下欄位（依情況出現）：

- `event`、`status`、`error`、`stopReason`
- `upstreamStatus`、`requestId`（上游的 `request-id`）
- `group`（邀請碼的組名）、`model`（代號）、`promptChars`

log 不含金鑰、邀請碼與提示全文。

## 模型白名單

`src/models.ts` 的 `MODELS`：代號 → 實際模型名稱、`max_tokens`、effort。`client/client.json` 的 `model` 只能填這裡的鍵（`src/models.target.test.ts` 會檢查，客戶檢查也會對各客戶執行）。目前只有一個代號：

| 代號 | 模型 | `max_tokens` | effort |
| --- | --- | --- | --- |
| `standard` | `claude-opus-5-5` | 8000 | `low` |

Opus 5.5 的 thinking 無法關閉，thinking 的 token 也算在 `max_tokens` 內。

## secret 與變數

| 名稱 | 種類 | 預設 | 內容 |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret | （必填） | Anthropic API 金鑰 |
| `ACCESS_CODES` | secret | （必填） | 邀請碼，格式 `組名:碼,碼;組名:碼`。組名為小寫英數與 `-`（最多 32 字元），碼至少 8 個英數字元，同一個碼不可出現在兩組 |
| `DISABLED_GROUPS` | 變數 | 空 | 停用的組，逗號分隔；停用後該組的碼回 401 |
| `DAILY_LIMIT` | 變數 | 30 | 每個邀請碼每日次數上限，以 UTC 換日 |
| `MAX_PROMPT_CHARS` | 變數 | 20000 | 提示的字元數上限 |
| `ALLOWED_ORIGINS` | 變數 | 空 | 同站以外允許的 `Origin`，逗號分隔；空值表示只允許同站 |

### 本機開發

1. 複製範例：`cp .dev.vars.example .dev.vars`。`.dev.vars` 已列在 `.gitignore`，不進版本控制。
2. 在 `.dev.vars` 填入 `ANTHROPIC_API_KEY`（由人填寫）與自己的 `ACCESS_CODES`。
3. 執行 `npm run build`，再執行 `npx wrangler dev`（預設 `http://localhost:8787`）。
4. 要以 `npm run dev`（Vite，`http://localhost:5173`）開發前端時，另開一個終端機執行 `npx wrangler dev`。
   - Vite 會把 `/api/*` 轉給 `http://localhost:8787`（`vite.config.ts`），瀏覽器看到的都是同一個 origin，不需要 CORS。
   - Worker 收到的 `Origin` 是 Vite 的網址，所以 `.dev.vars` 要設 `ALLOWED_ORIGINS=http://localhost:5173`。

### 正式部署

- 以 `npx wrangler secret put ANTHROPIC_API_KEY`、`npx wrangler secret put ACCESS_CODES` 設定 secret，由人輸入。
- `ACCESS_CODES` 必須設定真實的邀請碼，不得沿用 `.dev.vars.example` 的 `demo:EXAMPLE1`。
- `ALLOWED_ORIGINS` 應為空值。`localhost` 只供本機開發。

## 已知限制

- 同站檢查只防瀏覽器的跨站呼叫：拿到邀請碼的人可以用 curl 偽造 `Origin`。費用上限實際靠邀請碼與每日次數。
- 次數以 UTC 換日，也就是台灣時間早上 8 點。上游失敗時已扣的次數不退還，Worker 也不重試。
- 計數用的 Durable Object 使用 SQLite 後端，這也是免費方案唯一能用的後端。
  - 免費方案每日 100,000 次請求，額度用完時 `/api/ask` 回 503 `limit_unavailable`。
  - 見 [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)。
- 組織或 workspace 的花費上限，上游回的是 400，只能從錯誤訊息辨識。訊息改變時會改回 `upstream_error`。
- 模型拒答時不改用其他模型，直接回 `upstream_refusal`。
- 費用：以 Opus 5.5（每百萬 token 輸入 $4、輸出 $20）估算。
  - 輸入約 6,000 token、輸出（含 thinking）約 1,500 token 時，一次約 $0.054。
  - 每日上限 30 次時，每個碼每天最多約 $1.6。
  - 實際以 Claude Console 的用量為準，建議在 Console 另設花費上限。
