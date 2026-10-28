# 客戶設定（`client/`）

所有依客戶而變的內容集中在 `client/`，換客戶時只修改這裡，不改程式（RFC 0001）。
每個設定檔對應 `client/schema/` 的一份 JSON Schema；跨檔的規則由 `scripts/check-client.mjs` 檢查。

> **發現客戶差異未涵蓋時，先擴充 Schema，不在程式中寫死。**（ADR 0001 後果）
> 擴充步驟見[擴充 Schema](#擴充-schema)。

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
| `knowledge-model.json` | `knowledge-model.schema.json` | 實體類型（含圖譜顏色）、關係類型、別名規則、合併策略 |
| `access.json` | `access.schema.json` | 可見等級、專案名單、角色 |
| `scenarios.json` | `scenarios.schema.json` | 示範情境與預設問題 |

## 共用格式（`common.schema.json`）

| 名稱 | 格式 | 範例 |
| --- | --- | --- |
| `LanguageCode` | BCP 47 語言代碼：語言（2～3 個小寫字母），可加文字（`-Hant`）與地區（`-TW`） | `zh-TW`、`en` |
| `LocalizedText` | 物件，鍵為語言代碼，值為非空字串 | `{ "zh-TW": "範例公司", "en": "Example Co." }` |
| `Id` | 小寫英數與連字號，英文字母開頭，最多 63 字元 | `sales-team` |
| `ModelCode` | 小寫英數與連字號，英文字母開頭，最多 32 字元 | `standard` |
| `IsoDate` | ISO 8601 日期 `YYYY-MM-DD` | `2026-01-05` |
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
| `model` | 是 | `ModelCode` | 問答使用的模型代號。只能填 Worker 端白名單（`worker/src/models.ts` 的 `MODELS`）中的代號；實際模型名稱與 `max_tokens` 由 Worker 決定（ADR 0001）。`check:client` 只檢查格式，代號是否在白名單由 `worker/src/models.test.ts` 檢查 |
| `dataset.path` | 是 | `RelativePath` | 資料集的資料夾，必須存在。格式見 [docs/dataset.md](dataset.md) |
| `evals.path` | 是 | `RelativePath` | 評測題庫的資料夾，必須存在。題庫格式在評測台的 Issue 加入 |
| `retrieval` | 否 | 物件，見下表 | 檢索參數。省略整個物件或其中的欄位時使用預設值 |
| `upload` | 否 | 物件，見下表 | 上傳文件的參數。省略整個物件或其中的欄位時使用預設值 |

`retrieval` 的欄位（運作方式見 [docs/retrieval.md](retrieval.md)）：

| 欄位 | 格式 | 預設值 | 說明 |
| --- | --- | --- | --- |
| `provider` | `keyword-hash` | `keyword-hash` | 使用哪個 `VectorProvider`。值必須登記在 `app/src/retrieval/providers.ts` 的 `PROVIDERS`；新增實作時同時在 Schema 的列舉與 `types.ts` 的 `ProviderId` 加上同名的值 |
| `topK` | 整數，1～20 | 5 | 回傳前幾名段落 |
| `minScore` | 0～1 | 0.1 | 最低分數門檻，低於此分數的段落不回傳 |

`upload` 的欄位：

| 欄位 | 格式 | 預設值 | 說明 |
| --- | --- | --- | --- |
| `passageMaxChars` | 整數，100～1000 | 300 | 切段時每段的字元數上限。客戶文件的寫法不同，會影響檢索，所以放在設定中。檔案大小（10 MB）、擷取後字數（50,000）、段落數（500）是保護瀏覽器的上限，固定在 `app/src/upload/parse.ts` |

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

## `knowledge-model.json`

只定義「有哪些類型」；具體的實體（某位人員、某個專案）與它們的別名屬於資料集，不放在這裡。

### `entityTypes[]`（至少 1 個）

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `id` | 是 | `Id`，不可重複 | 例如 `person`、`project` |
| `label` | 是 | `LocalizedText` | 顯示名稱 |
| `color` | 是 | `#RRGGBB` | 圖譜中節點的顏色（[docs/graph.md](graph.md)）。沒有預設值：類型由客戶定義 |
| `aliasRules.ignoreCase` | 是 | boolean | 比對名稱與別名時忽略大小寫 |
| `aliasRules.normalizeWidth` | 是 | boolean | 比對前把全形英數與符號轉為半形 |
| `aliasRules.ignoreWhitespace` | 是 | boolean | 比對時忽略空白 |
| `mergeStrategy` | 否 | `review`／`auto`，預設 `review` | 名稱或別名相符時：`review` 放進待審，由人確認後合併；`auto` 直接合併成同一個實體 |

**為什麼預設 `review`**：名稱相符不代表是同一個實體。例如兩位同名的人員，自動合併會把他們合成同一個人，之後的關係、權限與引用都會跟著錯。只有名稱在客戶內部確定唯一的類型（例如部門），才改成 `auto`。

### `relationTypes[]`

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `id` | 是 | `Id`，不可重複 | 例如 `works-on` |
| `label` | 是 | `LocalizedText` | 顯示名稱 |
| `from` | 是 | 實體類型 `id` 陣列，至少 1 個 | 關係的起點可以是哪些類型；必須存在於 `entityTypes` |
| `to` | 是 | 實體類型 `id` 陣列，至少 1 個 | 關係的終點可以是哪些類型；必須存在於 `entityTypes` |

## `access.json`

展示用的權限設定；實際的權限一律由 PostgreSQL RLS 執行（ADR 0001），本檔只提供 RLS 使用的角色與等級。

### `visibilityLevels[]`（至少 1 個）

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `id` | 是 | `Id`，不可重複 | 例如 `internal` |
| `label` | 是 | `LocalizedText` | 顯示名稱 |
| `rank` | 是 | 0 以上的整數，不可重複 | 越大越機密。角色看得到 `rank` 小於或等於自己等級的內容 |

### `projects[]`

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `id` | 是 | `Id`，不可重複 | 例如 `bluewing` |
| `label` | 是 | `LocalizedText` | 顯示名稱 |

### `roles[]`（至少 1 個）

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `id` | 是 | `Id`，不可重複 | 例如 `staff` |
| `label` | 是 | `LocalizedText` | 顯示名稱（切換身分時顯示） |
| `visibility` | 是 | 可見等級 `id` | 此角色最高可看到的等級；必須存在於 `visibilityLevels` |
| `projects` | 是 | 專案 `id` 陣列，可為空、不重複 | 此角色可看到的專案；必須存在於 `projects` |
| `canUpload` | 是 | boolean | 能否上傳文件。可上傳的可見等級與專案同樣限於此角色看得到的範圍，由資料庫的 RLS 執行（`docs/data-model.md`「寫入規則」） |
| `canReview` | 是 | boolean | 能否核准或退回上傳文件的萃取結果（待審區）。只能審核自己看得到的文件，由資料庫的 RLS 執行（`docs/data-model.md`「待審與核准」） |

## `scenarios.json`

### `scenarios[]`（至少 1 個）

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `id` | 是 | `Id`，不可重複 | 例如 `staff-onboarding` |
| `title` | 是 | `LocalizedText` | 情境名稱 |
| `description` | 否 | `LocalizedText` | 情境說明 |
| `role` | 是 | 角色 `id` | 進入情境時切換成的身分；必須存在於 `access.json` 的 `roles` |
| `questions[].id` | 是 | `Id`，同一情境內不可重複 | 例如 `bluewing-lead` |
| `questions[].text` | 是 | `LocalizedText` | 預設問題，至少 1 題 |
| `questions[].answerPassages` | 是 | 資料集段落 `id` 陣列，至少 1 個、不重複 | 答案所在的段落；必須存在於資料集（匯入程式檢查），且該情境的角色看得到 |

## 跨檔規則

JSON Schema 無法參照另一個檔的值，以下由 `scripts/check-client.mjs` 在 Schema 驗證之後檢查。某個檔沒有通過 Schema 時，不對它做參照檢查，先修正 Schema 錯誤。

- `LocalizedText` 的語言（見「共用格式」）、`defaultLanguage` 必須在 `languages` 內
- 同一個清單內 `id` 不重複；`visibilityLevels` 的 `rank` 不重複
- 關係類型的 `from`、`to` → `entityTypes`
- 角色的 `visibility` → `visibilityLevels`；角色的 `projects` → `projects`
- 情境的 `role` → `roles`

## app 如何讀取

`app/src/client/load.ts` 在 build 時以 JSON import 讀入 5 個設定檔，匯出型別為 `ClientConfig` 的 `clientConfig`。

- 執行時不做 ajv 驗證，ajv 不打包進前端；驗證只在 `npm run check:client` 與 CI 執行。
- 省略的欄位在這裡補上預設值，讀取端拿到的型別一律是必填。目前有 `mergeStrategy`（省略時補成 `review`）、`retrieval` 的各欄位（`RETRIEVAL_DEFAULTS`）與 `upload` 的各欄位（`UPLOAD_DEFAULTS`）；預設值與 Schema 的 `default` 相同，由 `load.test.ts` 比對。

## 擴充 Schema

JSON Schema 是唯一正本，型別在 `app/src/client/types.ts` 手寫。加欄位或物件時改這幾處：

1. `client/schema/*.schema.json`
2. `app/src/client/types.ts`：對應的型別
3. `app/src/client/keys.ts`（資料集為 `app/src/dataset/keys.ts`）：該物件的鍵清單（新物件要新增一筆）
4. 有預設值的選填欄位：在 `load.ts` 補上預設值
5. 範例設定、本文件，以及需要時 `scripts/check-client.mjs` 的跨檔規則與測試

漏改時會被擋下：

- 型別與鍵清單不一致（多鍵、少鍵、必填標錯）→ `npm run typecheck` 失敗（`satisfies KeyManifest<T>`）
- 鍵清單與 Schema 的 `properties`、`required` 不一致，或 Schema 中有物件沒有鍵清單 → `npm test` 失敗（`app/src/client/schema-sync.test.ts`）
- 範例設定缺欄位或型別不符 → `npm run typecheck` 失敗（`load.ts`）
- 範例設定不符合 Schema（含列舉值）→ `npm run check:client` 失敗

## 測試資料

`scripts/fixtures/invalid-client/` 是故意寫錯的設定，用來確認驗證會失敗並指出欄位；不要「修正」它。
