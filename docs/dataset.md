# 資料集（`client/data/`）

template 預設的**虛構**資料：範例公司（Example Co.）的文件、段落、實體與關係。它是 demo 的預設內容，也是檢索、問答、圖譜、評測台開發與測試的基準。換客戶時替換這份資料，不改程式（RFC 0001）。

> 一律使用虛構資料，不得加入真實客戶資料、客戶名稱或合作夥伴品牌名稱（AGENTS.md 第 5 節）。

## 內容

範例公司：約 150 人的辦公家具製造商，不寫地點。

| 類別 | 內容 |
| --- | --- |
| 部門 | 產品研發部、營運部、人資部、業務部 |
| 專案 | 青翼專案（可調式辦公桌「青翼桌」，研發部）、長堤專案（倉儲系統更新，營運部） |
| 人物 | 王小明、周大衛、林志明（研發部）、林志明（業務部）、吳宜蓁、張雅婷、黃建宏、李佳穎，各有英文名 |
| 文件 | 16 份：繁中 8 份、英文 8 份，涵蓋三種可見等級、兩個專案與沒有專案的文件；每份都有日期 |
| 段落 | 43 段：繁中 25 段、英文 18 段，約 60:40 |

中英文比例以**段落數**計算：檢索與問答的對象是段落，不是文件（#26 決定，取代 #15 以文件數計算）。

刻意放入、供之後功能展示的內容：

- **同名但不同人**：兩位「林志明」是不同的實體（`person-lin-zhiming-rd`、`person-lin-zhiming-sales`），英文名都是 Zhiming Lin，以部門區分。`org-chart-zh-04` 明確說明公司有兩位林志明。這是人物的合併策略預設送審的理由（`docs/client-config.md`）。
- **每題預設問題都有兩種語言的答案段落**：檢索不支援跨語言（第 2 階段），所以英文問題要有英文的答案段落。新增預設問題時同樣補齊（`app/src/retrieval/scenarios.target.test.ts` 會檢查，客戶檢查也會執行）。
- **中英文別名**：人物的中文名在 `name`、英文名在 `aliases`。中文文件用中文名，英文文件用英文名，例如王小明＝Ming Wang。畫面顯示用的名稱另外放在 `names`（每種介面語言一個）。
- **說法不同**：青翼桌的上市時間，中文與英文各有一組。
  - 中文：`bluewing-kickoff-zh-02`（2026-02-10）寫第二季；較新的 `bluewing-status-zh-01`（2026-05-15）寫延後到第三季
  - 英文：`bluewing-spec-en-05`（2026-03-03）寫第二季；較新的 `bluewing-status-en-01`（2026-05-15）寫延後到第三季
  - 同一語言的兩段都來自不同文件，問答以文件標題並列來源
  - 預設問題 `bluewing-launch` 的 `answerPassages` 列出這四段，供「說法不同時並列」使用。修改其中一段時，要維持同一語言的兩段說法不同
  - 這四段也是 `project-bluewing` 的出處，時間軸依「青翼專案」篩選時能看到第二季改成第三季（#31 決定 4）
- **比所屬文件更機密的段落**：`bluewing-kickoff-zh-03`（預算）、`longpier-progress-zh-03`（超支）是機密段落；`org-chart-zh-05` 是沒有專案的文件中屬於長堤專案的段落。
- **公開但屬於專案的文件**：`bluewing-press-en` 是公開等級，但屬於青翼專案，訪客看不到（`docs/data-model.md`：可見等級與專案兩者都要符合）。

`app/tests/dataset/dataset.test.ts` 以測試確認上述內容存在，並以 `app/tests/db/oracle.ts` 對資料集計算滲漏矩陣。

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
| `entities[].name` | 是 | 字串 | 主要名稱，萃取與合併時使用 |
| `entities[].names` | 是 | `LocalizedText` | 各介面語言的顯示名稱；必須涵蓋 `client.json` 的每種 `languages`（匯入時檢查）。兩位林志明的顯示名稱相同，以 id 與所屬部門區分 |
| `entities[].aliases` | 否 | 字串陣列，不重複 | 其他名稱，例如英文名，供萃取與合併比對；目前不寫入資料庫。畫面顯示用 `names` |
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

**跨檔規則**（`app/src/dataset/validate.ts`，匯入時執行；`dataset.target.test.ts` 確認資料集通過：`npm test` 對 `client/data/`、客戶檢查 `npm run check:clients` 對各客戶執行，見 [docs/client-config.md](client-config.md)「客戶檢查」）：

- 文件與段落的語言屬於 `client.json` 的 `languages`
- 可見等級與專案存在於 `access.json`
- 段落不比所屬文件寬鬆：段落的 rank 不小於文件；文件有專案時，段落的專案必須相同。沒有專案的文件可以有屬於專案的段落
- 實體與關係的類型存在於 `knowledge-model.json`，關係兩端的實體存在，且類型符合關係類型的 `from`／`to`
- 實體與關係的出處段落存在
- 文件、段落、實體、關係的 id 不重複（段落 id 在整個資料集中唯一）
- `scenarios.json` 每個問題的 `answerPassages` 存在於資料集
- `dataset.path` 為 `data/`：`import.meta.glob` 的路徑必須是 `@client/` 開頭的字面值，所以 app 目前只支援這個位置

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
- 文件的 `date` 寫入 `kk.documents.document_date`，實體的 `names` 寫入 `kk.entities.names`（0004 migration，#31）。
- 目前不寫入資料庫：實體的 `aliases`，留給萃取與合併的 Issue（#15 決定 3）。

## 替換與擴充

- **換客戶**：替換 `documents/`、`entities.json`、`relations.json`，並依新的知識模型與權限調整 `client/` 的設定。
- **加欄位**：依 `docs/client-config.md`「擴充 Schema」的步驟，型別在 `app/src/dataset/types.ts`、鍵清單在 `app/src/dataset/keys.ts`。
