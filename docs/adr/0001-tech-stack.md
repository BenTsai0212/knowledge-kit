# ADR 0001：技術選型

- 狀態：Accepted（2026-10-26）
- 決定者：@BenTsai0212
- 相關：RFC 0001

## 背景

RFC 0001 要求換客戶時只修改 `client/`，並讓 coding agent 能快速、安全地修改。既有的展示原型是單一 HTML 加原生 JavaScript，資料庫（PGlite）在瀏覽器內執行，模型呼叫經 Cloudflare Worker 轉發。這個架構已驗證可以運作，但程式不分模組、沒有型別檢查。

## 選項

1. 靜態檔＋原生 ES 模組（不用打包工具）
2. 同 1，再以 JSDoc 加 `tsc --checkJs` 做型別檢查
3. Vite＋TypeScript＋React

## 決定

選項 3。

| 項目 | 決定 |
| --- | --- |
| 前端 | Vite＋TypeScript＋React，放在 `app/`，build 輸出到 `dist/` |
| 瀏覽器內資料庫 | npm 套件 `@electric-sql/pglite`（含 pgvector、pg_trgm 擴充）；權限一律由 PostgreSQL RLS 執行。不沿用舊原型為特定平台而做的 tar／gzip 擴充載入方式 |
| 圖譜 | `cytoscape` |
| 模型轉發 | Cloudflare Worker（TypeScript，放在 `worker/`），同時提供 `dist/` 靜態檔。API 金鑰與邀請碼只放在 Worker secret；模型名稱與 `max_tokens` 由 Worker 端白名單決定，`client/` 只能從白名單中選擇 |
| 檢索 | 定義 `VectorProvider` 接口；預設實作為關鍵字＋字元雜湊（非語意模型）。語意向量在 fork 中替換此實作 |
| 語言 | 語言清單放在 `client/`，預設 `zh-TW`、`en`；介面文字走翻譯檔；文件與段落帶語言欄位 |
| 客戶設定 | `client/*.json`，以 `client/schema/` 的 JSON Schema 驗證 |
| 套件管理 | npm，Node 22，提交 lockfile |

### 核准的套件

- 執行：`react`、`react-dom`、`@electric-sql/pglite`、`cytoscape`
- 開發與建置：`vite`、`@vitejs/plugin-react`、`typescript`、`@types/react`、`@types/react-dom`、`@types/cytoscape`
- Worker：`wrangler`、`@cloudflare/workers-types`
- 測試與檢查：`vitest`、`ajv`、`@playwright/test`

新增此清單以外的套件，依 `AGENTS.md` 第 6 節先問人。

### 偵測工具（全部進 CI）

- `tsc --noEmit` 型別檢查
- Vitest 單元測試：資料層、RLS、檢索、Worker
- 設定檔 Schema 驗證（ajv）
- Playwright 冒煙測試：頁面載入、問答（模擬模型）、身分切換、越權測試
- 敏感資料檢查腳本：API 金鑰格式、個人 email；客戶名稱等黑名單放在不進版本控制的本機檔，CI 只檢查通用格式
- 結構測試：確認語言與 `VectorProvider` 接口存在（RFC 0001 第一階段門檻 ⑤）

### 程式來源

以既有展示原型的功能為參考重寫，不直接複製檔案。合作夥伴的視覺設計（色票、字體、版面、元件樣式、介面互動）可參考或沿用，但不使用其品牌名稱與 wordmark。與特定客戶相關的程式與內容（官網匯入清洗、客戶專屬知識模型、資料、報告）一律不採用。

## 後果

- 多一個 build 步驟，fork 後需先執行 `npm install`
- 第一階段工作量比直接移植大；換來元件化、型別檢查，並與第 3 階段的正式系統使用同一套前端技術
- 「換客戶不改程式」的前提是 `client/` 的 Schema 涵蓋所有客戶差異；發現缺漏時先擴充 Schema，不在程式中寫死客戶內容
