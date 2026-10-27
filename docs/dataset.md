# 資料集（`client/data/`）

template 預設的**虛構**資料：範例公司（Example Co.）的文件、段落、實體與關係。它是 demo 的預設內容，也是檢索、問答、圖譜、評測台開發與測試的基準。換客戶時替換這份資料，不改程式（RFC 0001）。

> 一律使用虛構資料，不得加入真實客戶資料、客戶名稱或合作夥伴品牌名稱（AGENTS.md 第 5 節）。

## 檔案

位置是 `client.json` 的 `dataset.path`（預設 `data/`，相對於 `client/`）。

| 檔案 | Schema | 內容 |
| --- | --- | --- |
| `documents/<名稱>.<語言>.json` | `client/schema/data/document.schema.json` | 一份文件與它的段落；每份文件一個檔 |
| `entities.json` | `client/schema/data/entities.schema.json` | 實體 |
| `relations.json` | `client/schema/data/relations.schema.json` | 關係 |
| `README.md` | — | 資料集說明 |

- 檔名的 `<語言>` 只是慣例，方便辨認；文件語言以檔案內的 `language` 為準。
- 資料夾中其他的 `.json` 檔算錯誤（「未知的資料檔」）。

## 文件（`documents/*.json`）

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `id` | 是 | `Id` | 文件 id |
| `title` | 是 | 字串 | 標題，使用文件的語言 |
| `language` | 是 | `LanguageCode` | 文件語言 |
| `date` | 否 | `IsoDate` | 文件日期，供時間軸使用。範例資料集的每份文件都填寫 |
| `visibility` | 是 | 可見等級 `id` | `access.json` 的可見等級 |
| `project` | 否 | 專案 `id` | `access.json` 的專案；省略表示沒有專案（只依可見等級判斷，見 `docs/data-model.md`） |
| `passages` | 是 | 陣列，至少 1 個 | 段落，依順序排列 |

### 段落（`passages[]`）

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `id` | 是 | `Id` | 段落 id，作為實體與關係的出處、預設問題的答案 |
| `text` | 是 | 字串 | 內容，建議 1～3 句 |
| `language` | 否 | `LanguageCode` | 省略時沿用文件的值 |
| `visibility` | 否 | 可見等級 `id` | 省略時沿用文件的值；用來寫比文件更機密的段落 |
| `project` | 否 | 專案 `id` | 省略時沿用文件的值 |

段落在資料庫中必須同時看得到所屬文件，所以比文件寬鬆的段落沒有意義；匯入程式會把它當成錯誤。

## 實體（`entities.json`）

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `entities[].id` | 是 | `Id` | 實體 id |
| `entities[].type` | 是 | 實體類型 `id` | `knowledge-model.json` 的 `entityTypes` |
| `entities[].name` | 是 | 字串 | 主要名稱 |
| `entities[].aliases` | 否 | 字串陣列，不重複 | 其他名稱，例如英文名。目前不寫入資料庫，萃取與合併或圖譜的 Issue 再加入 |
| `entities[].sources` | 是 | 段落 `id` 陣列，至少 1 個 | 出處。沒有出處的實體沒有人看得到，所以必填 |

## 關係（`relations.json`）

| 欄位 | 必填 | 格式 | 說明 |
| --- | --- | --- | --- |
| `relations[].id` | 是 | `Id` | 關係 id |
| `relations[].type` | 是 | 關係類型 `id` | `knowledge-model.json` 的 `relationTypes` |
| `relations[].from` | 是 | 實體 `id` | 起點；類型必須符合關係類型的 `from` |
| `relations[].to` | 是 | 實體 `id` | 終點；類型必須符合關係類型的 `to` |
| `relations[].sources` | 是 | 段落 `id` 陣列，至少 1 個 | 出處 |

## 檢查

**`npm run check:client`**（`scripts/check-client.mjs`，CI 執行）：

- `client.json` 的 `dataset.path`、`evals.path` 指到的資料夾存在
- 資料集每個檔案符合 Schema；必要的檔案存在、至少一份文件、沒有未知的資料檔

**跨檔規則**（`app/src/dataset/validate.ts`，匯入時執行；`validate.test.ts` 確認 `client/data/` 通過，CI 的 `npm test` 執行）：

- 文件與段落的語言屬於 `client.json` 的 `languages`
- 可見等級與專案存在於 `access.json`
- 段落不比所屬文件寬鬆：段落的 rank 不小於文件；文件有專案時，段落的專案必須相同。沒有專案的文件可以有屬於專案的段落
- 實體與關係的類型存在於 `knowledge-model.json`，關係兩端的實體存在，且類型符合關係類型的 `from`／`to`
- 實體與關係的出處段落存在
- 文件、段落、實體、關係的 id 不重複（段落 id 在整個資料集中唯一）
- `scenarios.json` 每個問題的 `answerPassages` 存在於資料集
- `dataset.path` 為 `data/`：`import.meta.glob` 的路徑必須是字面值，所以 app 目前只支援這個位置

錯誤的格式與 `check:client` 相同：`<檔名> <JSON 路徑>：<訊息>`，檔名相對於 `client/`。

## 匯入

```ts
import { clientConfig } from "./client/load";
import { dataset } from "./dataset/load";
import { seedDataset } from "./dataset/seed";
import { openDatabase } from "./db/database";

const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
```

- `app/src/dataset/load.ts` 在 build 時讀入 `client/data/`，瀏覽器與 Vitest（Node）共用。
- `seedDataset` 先執行跨檔檢查。有錯誤時拋出 `DatasetImportError`，訊息逐條列出位置，不寫入任何資料。
- 段落的語言、可見等級、專案在匯入時套用沿用規則，資料庫中每個段落都有明確的值。
- 段落的 `ordinal` 是它在 `passages` 中的順序。
- 目前不寫入資料庫：
  - 文件的 `date`：供之後的時間軸使用
  - 實體的 `aliases`：留給萃取與合併或圖譜的 Issue（#15 決定 3）
  - 兩者都需要新的 migration

## 替換與擴充

- **換客戶**：替換 `documents/`、`entities.json`、`relations.json`，並依新的知識模型與權限調整 `client/` 的設定。
- **加欄位**：依 `docs/client-config.md`「擴充 Schema」的步驟，型別在 `app/src/dataset/types.ts`、鍵清單在 `app/src/dataset/keys.ts`。
