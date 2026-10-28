# 檢索（`app/src/retrieval/`）

問答之前的一步：依問題找出**目前身分看得到**的相關段落，回傳前幾名。產生回答與引用不在本模組。決策紀錄見 #22。

## 運作方式

```ts
const retriever = openRetriever(db, clientConfig.client.retrieval);
const passages = await retriever.retrieve("staff", "到職滿一年有幾天年假？");
// [{ id, documentId, documentTitle, language, content, score }, …]，依 score 由高到低
```

1. 以 `db.withIdentity(identityId, …)` 執行 `SELECT … FROM kk.passages`。看得到哪些段落完全交給 RLS（[docs/data-model.md](data-model.md)），本模組不另外判斷權限。
   - 文件標題（問答以標題區分來源）以 JOIN `kk.documents` 在同一個查詢中取得。兩張表都受 RLS 篩選，但資料集規定段落不比所屬文件寬鬆（[docs/dataset.md](dataset.md)，匯入時檢查），所以看得到段落就看得到文件，JOIN 不會少掉段落。`app/tests/retrieval/leakage.test.ts` 的「不限名次時漏看 0」確認這一點。
2. 以 `VectorProvider` 把問題與段落轉成向量，再算相似度。
3. 依分數排序，去掉低於 `minScore` 的段落，取前 `topK` 名。分數相同時依段落 id 排序。

`retrieve.ts` 只依賴 `VectorProvider` 接口。使用哪個實作，只在 `providers.ts` 依 `client.json` 的 `retrieval.provider` 決定（`providers.test.ts` 檢查）。

## 設定

設定在 `client.json` 的 `retrieval`，欄位與預設值見 [docs/client-config.md](client-config.md#clientjson)：

| 欄位 | 預設值 | 意思 |
| --- | --- | --- |
| `provider` | `keyword-hash` | 使用哪個實作 |
| `topK` | 5 | 回傳前幾名 |
| `minScore` | 0.1 | 最低分數門檻 |

預設值的依據：以參考資料集測試，7 題預設問題中，與問題同語言的答案段落最差排第 2 名，分數都在 0.23 以上。0.1 的門檻用來排除只有零星共同字元的段落。

## 預設實作：`keyword-hash`

這是關鍵字＋字元特徵的雜湊向量，**不是語意模型**。

**切詞**（`tokenize.ts`）：先做 NFKC 正規化、轉成小寫，再依字元的文字類別切段。依字元判斷、不依語言標籤，所以中英混排的段落也能處理。

| 文字類別 | 關鍵字特徵（權重 1） | 字元特徵（權重 0.5） |
| --- | --- | --- |
| 漢字（中文沒有空格） | 相鄰兩字一組，例如「青翼專案」→ 青翼、翼專、專案 | 單字 |
| 其他文字與數字 | 以空白與標點切出的單字；去掉英文停用詞與字尾複數 `s` | 前後補 `^`、`$` 後的 3 字元組，例如 `^de`、`des`、`esk`、`sk$` |

- **停用詞**：
  - 英文約 40 個（the、is、who…）。
  - 中文是常見虛字（的、是、誰、嗎…）：兩個字都是停用字的雙字組不計，單字特徵也不計停用字。
- **兩種特徵的作用**：
  - 關鍵字特徵抓整詞命中。
  - 字元特徵容許部分命中，例如「調薪」對上「薪資」、`launch` 對上 `launched`。
- **計分**（`keyword-hash.ts`）：
  - 特徵以 FNV-1a 雜湊到 4096 維，次數乘上權重後加總，再做 L2 正規化。
  - 分數是 cosine 相似度，範圍 0～1。
  - 比重 1:0.5 是常數，不放進設定（#22 決定 3）。
- **不使用 IDF**：IDF 要依全部段落計算，而各身分看得到的段落不同，會讓分數依身分而變。

## 向量快取

- 段落向量在第一次檢索時計算，存在 retriever 的記憶體快取中，鍵是段落 id。之後只要轉換問題。
- 快取不影響可見範圍：每次檢索都先經過 `withIdentity()`，只有 RLS 回傳的段落會被計分。快取中有別的身分看得到的段落，也不會被選進結果（`app/tests/retrieval/leakage.test.ts` 以交替身分測試）。
- **之後的上傳功能**：
  - 新增段落：新的 id 會在下次檢索時自動計算，不需處理。
  - 修改段落內容：快取以 id 為鍵，不會發現內容變了，修改時必須一併清掉該段的快取（或改以內容雜湊為鍵）。
- 快取不存進資料庫，所以不需要 migration。

## 限制

- **非語意**：只比對共同的詞與字元，不懂同義詞與換句話說。例如「主管」找不到只寫「經理」的段落，`vacation` 找不到只寫 `annual leave` 的段落。
- **不支援跨語言**：中文問題找不到只有英文的段落，反之亦然。參考資料集的每題預設問題在兩種語言都有答案段落（#26），所以 14 個檢查都能通過；跨語言檢索是第 2 階段。
- **新增語言**：
  - 以空白分詞的語言：不必改程式，但英文停用詞與去掉複數 `s` 的規則只適用英文。
  - 日文、泰文這類不以空白分詞的語言：需在 `tokenize.ts` 加上切詞規則。
- **規模與效能**：
  - 每次檢索都掃過全部段落；RLS 對每一列呼叫 `kk.can_see()` 查一次身分，再在 JS 中逐段計分，時間隨段落數線性增加。
  - 參考資料集（43 段）的本機量測（Node 24、PGlite 記憶體資料庫）：

    | | 訪客 | 一般員工 | 主管 |
    | --- | --- | --- | --- |
    | 看得到的段落 | 8 | 29 | 43 |
    | 快取建立後，一次檢索（50 次平均） | 1.33 ms | 1.35 ms | 1.39 ms |
    | 第一次檢索（含計算全部段落的向量） | 3.0 ms（含 PGlite 第一次查詢的暖機） | 1.75 ms | 1.92 ms |

    三次執行取中位數。其中約 1.2 ms 是 `withIdentity()` 與 `SELECT`。量測方式是以 `openRetriever` 對同一個問題連續檢索 50 次，取平均。
  - 數千段內預估仍在數十 ms。更大的規模需要先在 SQL 中篩出候選段落（索引、pgvector 等），屬於範圍外的工作。

## 替換 `VectorProvider`

例如換成語意向量：

1. 新增實作，滿足 `types.ts` 的 `VectorProvider<V>`：
   - `id`：與 `client.json` 的 `retrieval.provider` 相同。
   - `embed(texts)`：一次轉換多筆文字，可在其中批次呼叫外部 API。
   - `similarity(a, b)`：回傳 0～1，越大越相關。
2. 在 `providers.ts` 的 `PROVIDERS` 登記。
3. 在 `client/schema/client.schema.json` 的 `retrieval.provider` 列舉，以及 `app/src/client/types.ts` 的 `ProviderId`，加上同名的值。
4. 改 `client.json` 的 `retrieval.provider`；分數分布不同時，一併調整 `minScore` 與 `topK`。

注意：

- `retrieve.ts`、問答與資料層的程式不需要修改；除了 `providers.ts`，不要在其他地方匯入具體實作（結構測試會失敗）。
- 段落一律經過 `withIdentity()` 取得，實作只負責轉換與計分，不要自行查詢資料庫。
- 呼叫外部 API 會產生費用，並需要新的 secret（AGENTS.md 第 6 節：先問人）。段落文字會送到外部服務，機密段落是否可以送出也要先確認。
- 向量要持久化時（避免每次載入都重算），新增資料表屬於 migration（高風險），並要為它設定 RLS，讓看不到段落的身分也看不到它的向量。
- 換實作後重跑 `app/src/retrieval/scenarios.test.ts` 與 `app/tests/retrieval/leakage.test.ts`。
