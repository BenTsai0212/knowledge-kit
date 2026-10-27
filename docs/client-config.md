# 客戶設定（`client/`）

所有依客戶而變的內容集中在 `client/`，換客戶時只修改這裡，不改程式（RFC 0001）。
每個設定檔對應 `client/schema/` 的一份 JSON Schema；跨檔的規則由 `scripts/check-client.mjs` 檢查。

> **發現客戶差異未涵蓋時，先擴充 Schema，不在程式中寫死。**（ADR 0001 後果）
> 擴充時同步更新本文件與 `scripts/check-client.mjs` 的測試。

## 檢查

```bash
npm run check:client
```

- 驗證 `client/` 頂層的每個 `.json` 檔；缺少設定檔、未知的設定檔、多餘的欄位都算錯誤。
- 錯誤逐行印出 `<檔名> <欄位路徑>：<訊息>`，有錯誤時以非 0 結束。CI 的 `checks` job 會執行。
- 檢查其他資料夾：`node scripts/check-client.mjs <資料夾>`（Schema 一律用 `client/schema/`）。

## 檔案

| 檔案 | Schema | 內容 |
| --- | --- | --- |
| `client.json` | `client.schema.json` | 基本資訊、語言、模型、資料集與評測題庫的位置 |
| `theme.json` | `theme.schema.json` | 色票、字體 |

知識模型（`knowledge-model.json`）、角色與權限（`access.json`）、示範情境（`scenarios.json`）的設定檔由 #5 的後續 PR 加入。

## 共用格式（`common.schema.json`）

| 名稱 | 格式 | 範例 |
| --- | --- | --- |
| `LanguageCode` | BCP 47 語言代碼：語言（2～3 個小寫字母），可加文字（`-Hant`）與地區（`-TW`） | `zh-TW`、`en` |
| `LocalizedText` | 物件，鍵為語言代碼，值為非空字串 | `{ "zh-TW": "範例公司", "en": "Example Co." }` |
| `Id` | 小寫英數與連字號，英文字母開頭，最多 63 字元 | `sales-team` |
| `ModelCode` | 小寫英數與連字號，英文字母開頭，最多 32 字元 | `standard` |
| `RelativePath` | 相對於 `client/` 的路徑，不可用 `/` 開頭或包含 `..` | `data/` |

**顯示給使用者的文字一律用 `LocalizedText`**，並符合：

- 鍵必須屬於 `client.json` 的 `languages`。
- 必須包含 `client.json` 的 `defaultLanguage`；其他語言可以缺少，顯示時退回預設語言。

## `client.json`

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `displayName` | 是 | `LocalizedText` | 客戶的顯示名稱，用在頁面標題等處。一律使用虛構名稱 |
| `defaultLanguage` | 是 | `LanguageCode` | 預設語言；必須在 `languages` 內 |
| `languages` | 是 | `LanguageCode` 陣列，至少 1 個、不重複 | 支援的語言。範本預設 `["zh-TW", "en"]` |
| `model` | 是 | `ModelCode` | 問答使用的模型代號。只能填 Worker 端白名單中的代號；白名單、實際模型名稱與 `max_tokens` 由 Worker 決定（ADR 0001），在 `/api/ask` 的 Issue 實作。目前只檢查格式 |
| `dataset.path` | 是 | `RelativePath` | 資料集的位置。目前只檢查格式，不檢查是否存在 |
| `evals.path` | 是 | `RelativePath` | 評測題庫的位置。目前只檢查格式，不檢查是否存在 |

## `theme.json`

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `colors.primary` | 是 | `#RRGGBB` | 主色：按鈕、連結、重點 |
| `colors.onPrimary` | 是 | `#RRGGBB` | 放在主色上的文字顏色 |
| `colors.background` | 是 | `#RRGGBB` | 頁面背景 |
| `colors.surface` | 是 | `#RRGGBB` | 卡片、面板背景 |
| `colors.text` | 是 | `#RRGGBB` | 主要文字 |
| `colors.textMuted` | 是 | `#RRGGBB` | 次要文字 |
| `colors.border` | 是 | `#RRGGBB` | 邊框與分隔線 |
| `fonts.body` | 是 | CSS `font-family` 值 | 內文字體 |
| `fonts.heading` | 是 | CSS `font-family` 值 | 標題字體 |

不使用任何合作夥伴的品牌名稱、wordmark 或專屬字體名稱作為預設值（RFC 0001）。

## 測試資料

`scripts/fixtures/invalid-client/` 是故意寫錯的設定，用來確認驗證會失敗並指出欄位；不要「修正」它。
