# 知識圖譜、多跳路徑、時間軸（`app/src/graph/`）

以圖譜呈現**目前身分看得到**的實體與關係，找出兩個實體之間的最短路徑，並以時間軸呈現文件的先後。決策紀錄見 #31。

## 資料來源

| 資料 | 來源 | 資料表 |
| --- | --- | --- |
| 實體 | `client/data/entities.json`（之後加上萃取） | `kk.entities`（`names` 是各語言的顯示名稱）、`kk.entity_sources` |
| 關係 | `client/data/relations.json`（同上） | `kk.relations`、`kk.relation_sources` |
| 文件與段落 | `client/data/documents/*.json` | `kk.documents`（`document_date`）、`kk.passages` |
| 實體與關係類型的名稱 | `client/knowledge-model.json` 的 `label` | 不進資料庫 |

- 實體的顯示名稱用 `names[介面語言]`；`name` 是主要名稱，萃取與合併時使用（[docs/dataset.md](dataset.md)）。
- 兩位「林志明」是不同的實體，顯示名稱相同，以所屬部門的關係區分。

## 權限

三種資料一律經 `db.withIdentity()` 讀取，看得到哪些列完全交給 RLS（[docs/data-model.md](data-model.md)「權限規則」），本模組不另外判斷：

- **實體**：至少一個出處段落看得到。
- **關係**：至少一個出處段落看得到，且兩端的實體都看得到。
- **出處**：只回傳看得到的出處段落。
- **時間軸**：看得到的文件中，看得到的段落。

測試（`app/tests/graph/`）以 `app/tests/db/oracle.ts` 對每個身分（3 個角色、`null`、不存在的身分）比對，結果必須**正好**等於可見範圍（滲漏 0、漏看 0），並以「忽略身分、一律以主管查詢的資料層」做反向驗證：

| 測試 | 比對的內容 |
| --- | --- |
| `leakage.test.ts` | `readGraph()` 的實體、關係、實體出處、關係出處 |
| `path.test.ts` | 每對實體的路徑：有無、長度與 oracle 可見圖上的最短距離相同；每一步都是看得到的關係 |
| `timeline.test.ts` | 每種語言 × 每個實體篩選（含不篩選）的文件與段落；段落的 `entityIds` 只含看得到的實體 |

## 圖譜：`readGraph()`

```ts
const graph = await readGraph(db, "staff");
// { entities: [{ id, type, name, names, sources }], relations: [{ id, type, from, to, sources }] }
// sources: [{ id, documentId, documentTitle, language, content }]
```

一次讀出全部看得到的實體與關係（含出處段落），不依節點展開：資料集只有 14 個實體、19 個關係，一次讀出最簡單，權限也只需測試一個查詢。點出處時以 `readSource()`（`app/src/sources/source.ts`）打開原文。

## 多跳路徑：`shortestPath()`

```ts
shortestPath(graph, "person-huang-jianhong", "project-longpier");
// [{ entity: "person-huang-jianhong" }, { entity: "project-longpier", relation: "huang-works-on-longpier" }]
```

- **演算法**：在 `readGraph()` 回傳的可見圖上做 BFS，不分關係方向（方向只影響顯示）。可見圖已經過 RLS 篩選，所以路徑只會經過看得到的實體與關係，不另外查詢資料庫。
- **最大跳數**：`MAX_HOPS = 6`。超過的路徑意義不大，也避免大圖上走太遠。
- **多條最短路徑**：鄰居依（關係 id, 實體 id）排序後展開，結果固定可重現。
- **找不到**：起點或終點不在可見圖中、沒有連通、或超過 `MAX_HOPS`，都回 `null`。畫面顯示同一句固定文字，不區分原因，不透露是否因權限而找不到。
- 看不到中間節點時，即使兩端都看得到也找不到路徑。參考資料集沒有這種情況，所以 `path.test.ts` 另建小樣本（A —公開— B（機密）—公開— C）測試。

## 時間軸：`readTimeline()`

```ts
const entries = await readTimeline(db, "staff", { language: "zh-TW", entityId: "project-bluewing" });
// [{ documentId, title, date: "2026-02-10", language, passages: [{ id, content, entityIds }] }, …]
```

- **單位**：文件，附上其中看得到的段落（依文件中的順序）。沒有看得到的段落的文件不列出。
- **排序**：依日期由舊到新；沒有日期的文件排在最後（`date` 為 `null`）。日期相同時依文件 id。
- **語言**：只列出與介面語言相同的文件（#31 決定 2），與問答一致。
- **依實體篩選**：只留以該實體為出處的段落，以及有這類段落的文件。`entityIds` 是以該段為出處、且看得到的實體。
- **日期**：在 SQL 中以 `to_char(document_date, 'YYYY-MM-DD')` 轉成字串，不經過 JavaScript 的 `Date`，避免時區讓日期差一天；畫面直接顯示該字串。
- 參考資料集中，依「青翼專案」篩選時，中文與英文都能看出上市時間從第二季（較早的文件）改為第三季（2026-05-15 的進度更新）。上市時間的 4 段是 `project-bluewing` 的出處（#31 決定 4）。

## 畫面

工具列下的頁籤切換「問答／圖譜」，沿用身分與語言切換、「虛構資料」「展示用權限」標示。圖譜頁不呼叫模型，不需要邀請碼。

| 檔案 | 內容 |
| --- | --- |
| `ui/GraphPage.tsx` | 讀取圖譜；切換身分或語言時重新讀取，之後才回來的舊結果忽略（`ui/requests.ts`）；選取的節點已看不到時清除 |
| `ui/GraphView.tsx` | 以 cytoscape 畫圖：節點依實體類型著色（`knowledge-model.json` 的 `color`），標籤是 `names[介面語言]`，邊的標籤是關係類型的 `label` |
| `ui/EntityPanel.tsx` | 點節點時顯示類型、名稱、相關實體（可點）與出處段落；出處以 `readSource()` 打開原文 |
| `ui/graph-labels.ts` | 實體、類型、關係類型的顯示文字與相關實體 |

- **cytoscape**：以 `import("cytoscape")` 動態載入，build 時分成獨立的 chunk（約 435 KB，gzip 約 138 KB），只用問答的人不必下載。cytoscape 自帶型別，不安裝 `@types/cytoscape`（ADR 0001「修訂」）。
- **版面**：內建的 `cose`（力導向）。節點先依順序排成一個圓作為起始位置，並設 `randomize: false`，所以同樣的資料每次的版面相同；不需要額外的版面套件。
- **切換身分**：開啟的原文由 `App.tsx` 一律關閉；選取的節點在新身分下看不到時清除，看得到時保留。


- **規模**：每次都讀出全部看得到的實體與關係，路徑在前端計算。數千個實體以內沒有問題；更大的圖需要依節點展開或在資料庫中計算路徑。
- **參考資料集的圖分成 4 個不相連的群組**（研發／青翼、業務、人資、營運／長堤），多跳路徑只出現在同一個群組內，最長 2～3 跳。
- **路徑不考慮關係的方向與類型**：例如「A 負責 B」與「B 負責 A」視為相同的連結。
- **時間軸以文件日期為準**：段落沒有自己的日期；文件沒有日期時排在最後。
- **實體沒有日期**：無法呈現「某人何時加入專案」這類實體層級的時間軸。
- **同名實體**：兩位林志明的顯示名稱相同，畫面以所屬部門區分；合併策略見 `knowledge-model.json` 的 `mergeStrategy`（萃取與合併在 Epic 第 9 項）。
