# 檢索（`app/src/retrieval/`）

問答之前的一步：依問題找出**目前身分看得到**的相關段落，回傳前幾名。產生回答與引用不在本模組。決策紀錄見 #22。

## 運作方式

```ts
const retriever = openRetriever(db, clientConfig.client.retrieval);
const passages = await retriever.retrieve("staff", "到職滿一年有幾天年假？");
// [{ id, documentId, documentTitle, documentDate, language, content, score, supersededBy }, …]，依 score 由高到低
```

1. 以 `db.withIdentity(identityId, …)` 執行 `SELECT … FROM kk.passages`。看得到哪些段落完全交給 RLS（[docs/data-model.md](data-model.md)），本模組不另外判斷權限。
   - 文件標題（問答以標題區分來源）以 JOIN `kk.documents` 在同一個查詢中取得。兩張表都受 RLS 篩選，但資料集規定段落不比所屬文件寬鬆（[docs/dataset.md](dataset.md)，匯入時檢查），所以看得到段落就看得到文件，JOIN 不會少掉段落。`app/tests/retrieval/leakage.test.ts` 的「不限名次時漏看 0」確認這一點。
2. 以 `VectorProvider` 把問題（`embed([question], "query")`）與還不在快取中的段落（`embed(contents, "passage")`）分開轉成向量，再算相似度。
3. 依分數排序，去掉低於 `minScore` 的段落，取前 `topK` 名。分數相同時依段落 id 排序。
4. 為每段附上 `supersededBy`：主管標記「新說法取代舊說法」時，取代這段的新段落（id、文件標題與日期、語言、內容，以及取代新段落的段落 id）；沒有時為 `null`。在步驟 1 的同一個 `withIdentity()` 中讀取 `kk.conflict_decisions`，決定只在兩段都看得到時讀得到（RLS）。同一段被多段取代時取文件日期最新的，日期相同時依段落 id。新段落不計分、不佔名次。問答怎麼使用見 [docs/qa.md](qa.md)「新說法取代舊說法」。

### 個別呼叫的選項

`retrieve(identityId, question, options)` 的第三個參數（`RetrieveOptions`）可以只在這次呼叫改變條件，例如說法不同的比對（[docs/conflicts.md](conflicts.md)）：

| 選項 | 意思 |
| --- | --- |
| `language` | 只取這個語言的段落 |
| `excludeDocument` | 排除這份文件的段落 |
| `topK`、`minScore` | 取代 `client.json` 的設定 |

語言與文件的條件寫在 SQL 的 `WHERE`，仍在 RLS 篩選之內；可見範圍不變。

`retrieve.ts` 只依賴 `VectorProvider` 接口。使用哪個實作，只在 `providers.ts` 依 `client.json` 的 `retrieval.provider` 決定（`providers.test.ts` 檢查）。

實作可能要先下載模型才能使用，所以 `createProvider()` 回傳 Promise（未登記的值在呼叫時就拋錯）。`openRetriever()` 不等待，立即回傳 retriever；第一次 `retrieve()` 時才等實作準備好，準備失敗時由 `retrieve()` 拋出。

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

**切詞**（`tokenize.ts`）：先做 NFKC 正規化、轉成小寫，再經由[語言模組](#語言模組)依字元的文字類別切段。依字元判斷、不依語言標籤，所以中英混排的段落也能處理。

| 文字類別 | 切詞方式 | 關鍵字特徵（權重 1） | 字元特徵（權重 0.5） |
| --- | --- | --- | --- |
| 漢字（中文沒有空格） | `bigram` | 相鄰兩字一組，例如「青翼專案」→ 青翼、翼專、專案 | 單字 |
| 片假名（含長音符號 `ー`） | `word` | 整個詞，例如「マネージャー」 | 前後補 `^`、`$` 後的 3 字元組 |
| 平假名 | `bigram` | 相鄰兩字一組；兩字都是日文停用字的組合不計 | 單字（不計停用字） |
| 其他文字與數字 | `word` | 以空白與標點切出的單字；去掉英文停用詞與字尾複數 `s` | 前後補 `^`、`$` 後的 3 字元組，例如 `^de`、`des`、`esk`、`sk$` |

- **停用詞**：
  - 英文約 40 個（the、is、who…）。
  - 中文是常見虛字（的、是、誰、嗎…）：兩個字都是停用字的雙字組不計，單字特徵也不計停用字。
  - 日文是平假名的助詞與語尾（の、は、が、です、ます的各字…）：規則同中文。日文的漢字與中文共用漢字的規則與停用字。
- **兩種特徵的作用**：
  - 關鍵字特徵抓整詞命中。
  - 字元特徵容許部分命中，例如「調薪」對上「薪資」、`launch` 對上 `launched`。
- **計分**（`keyword-hash.ts`）：
  - 特徵以 FNV-1a 雜湊到 4096 維，次數乘上權重後加總，再做 L2 正規化。
  - 分數是 cosine 相似度，範圍 0～1。
  - 比重 1:0.5 是常數，不放進設定（#22 決定 3）。
- **不使用 IDF**：IDF 要依全部段落計算，而各身分看得到的段落不同，會讓分數依身分而變。

## 語言模組

語言或文字類別的規則只放在 `app/src/language/`（#83），檢索的切詞與上傳的[切段](upload.md#切段)都經由它處理：

| 檔案 | 內容 |
| --- | --- |
| `scripts.ts` | 文字類別的規則：字元範圍、切詞方式、套用的停用詞、字尾處理、換行與句子是否直接相連；全形標點；句尾標點 |
| `stopwords.ts` | 各語言的停用詞（目前 `en`、`zh`、`ja`；#83 決定 2：放在語言模組，不放 `client/`） |
| `text.ts` | 對外函式：`segments()`（切詞用）、`joinLine()`、`joinSentence()`、`splitSentences()`（切段用） |

- **依文字類別，不依語言代碼**：問題沒有可靠的語言標籤，段落也常中英混排。一段文字含多種類別時，每一小段各自套用自己類別的規則；語言代碼只用來指定停用詞。
- **切詞方式**：`bigram`（相鄰兩字一組）、`word`（以空白與標點切出單字）、`segmenter`（交給瀏覽器與 Node 內建的 `Intl.Segmenter` 斷詞，每個詞再以 `word` 處理）。
- **漢字維持 `bigram`**（#83 決定 3）：改用 `Intl.Segmenter` 時，字典裡沒有的專有名詞會被拆開（「青翼專案」→ 青、翼、專案），參考情境有答案段落的名次變差，而且斷詞結果隨 ICU 版本而不同，CI、本機與各版 Chrome 的分數可能不一致。`segmenter` 留給不以空白分詞、又不適合雙字組的文字（例如泰文）。
- **結構測試**（`app/src/language/structure.test.ts`）：`app/src/`、`worker/` 中語言模組以外的程式不得有文字類別的 Unicode 屬性（`\p{Script=…}` 等）、CJK 範圍的 `\u` 跳脫、含 CJK 字元或 `. ! ?` 的字元類別、停用詞表。

完整步驟（含客戶資料夾要改的地方與語意向量的比較）見 [docs/playbook/add-language.md](playbook/add-language.md)。

**新增語言**時只修改客戶資料夾（`client.json` 的 `languages`、翻譯檔、資料集）與語言模組：

1. 以空白分詞、文字類別已有規則的語言（例如法文、德文）：不必改語言模組；但英文停用詞與去掉複數 `s` 的規則套用在所有「其他文字」上，需要時在 `scripts.ts` 為該文字類別另加規則。
2. 不以空白分詞的語言（例如日文、泰文）：在 `scripts.ts` 的 `SCRIPTS` 加上該文字類別，選擇 `bigram` 或 `segmenter`；需要時在 `stopwords.ts` 加上停用詞。
3. 句尾標點或換行相連的方式不同時，修改 `scripts.ts` 的 `SENTENCE_ENDS`、`FULLWIDTH_PUNCTUATION` 或類別的 `joinsWithoutSpace`。
4. 執行 `npm run check:clients <名稱>`：`app/src/retrieval/scenarios.target.test.ts` 以該客戶的每種語言檢索預設問題，同語言的答案段落要在前 K 名內。

**日文的規則與實測**（#83）：以暫時的客戶 `clients/lang-ja/`（參考情境加上 `ja`：日文翻譯檔、實體的日文名稱、4 份日文文件、預設問題與 4 題日文題庫）驗證，只改了客戶資料夾與語言模組（`scripts.ts`、`stopwords.ts`）；暫時客戶不放進 repo（#77 決定 7）。

- 不加假名規則時，假名併入「其他文字」，連續的假名成為一個詞（例如「のマネージャーは」），日文問題靠漢字的雙字組仍排第 1，但分數偏低。
- 片假名以 `word`、平假名以 `bigram` 加日文停用字（採用）：日文的 7 題預設問題與 3 題作答題，答案段落都排第 1，最低分數 0.407。
- 假名改用 `segmenter`（`Intl.Segmenter` 的 `ja`）：同樣都排第 1，但最低分數 0.265，而且結果隨 ICU 版本而不同，所以不採用。
- 參考情境 `client/` 沒有假名，切詞與分數不變。

## 向量快取

- 段落向量在第一次檢索時計算，存在 retriever 的記憶體快取中，鍵是段落 id。之後只要轉換問題。
- 快取不影響可見範圍：每次檢索都先經過 `withIdentity()`，只有 RLS 回傳的段落會被計分。快取中有別的身分看得到的段落，也不會被選進結果（`app/tests/retrieval/leakage.test.ts` 以交替身分測試）。
- **之後的上傳功能**：
  - 新增段落：新的 id 會在下次檢索時自動計算，不需處理。
  - 修改段落內容：快取以 id 為鍵，不會發現內容變了，修改時必須一併清掉該段的快取（或改以內容雜湊為鍵）。
- 快取不存進資料庫，所以不需要 migration。

## 限制

- **非語意**：只比對共同的詞與字元，不懂同義詞與換句話說。例如「主管」找不到只寫「經理」的段落，`vacation` 找不到只寫 `annual leave` 的段落。
- **不支援跨語言**：中文問題找不到只有英文的段落，反之亦然。參考資料集的每題預設問題在兩種語言都有答案段落（#26），所以 14 個檢查都能通過；跨語言檢索是第 2 階段。語意向量的評估見[評估報告](evals/semantic-retrieval-2026-11.md)與 [ADR 0006](adr/0006-semantic-retrieval.md)（Proposed）。
- **新增語言**：見[語言模組](#語言模組)。
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
   - `embed(texts, kind)`：一次轉換多筆同一種文字，可在其中批次呼叫外部 API 或模型。`kind` 是 `"query"`（問題）或 `"passage"`（段落），語意模型可依此加不同前綴（例如 e5 的 `query: `、`passage: `）；不區分兩者的實作（`keyword-hash`）忽略它。
   - `similarity(a, b)`：回傳 0～1，越大越相關；cosine 為負時截到 0。`providers.test.ts` 對 `PROVIDERS` 中每個實作檢查範圍。
2. 在 `providers.ts` 的 `PROVIDERS` 登記建立實作的函式（可以是非同步，例如先下載模型）。
3. 在 `client/schema/client.schema.json` 的 `retrieval.provider` 列舉，以及 `app/src/client/types.ts` 的 `ProviderId`，加上同名的值。
4. 改 `client.json` 的 `retrieval.provider`；分數分布不同時，一併調整 `minScore` 與 `topK`。

注意：

- `retrieve.ts`、問答與資料層的程式不需要修改；除了 `providers.ts`，不要在其他地方匯入具體實作（結構測試會失敗）。
- 段落一律經過 `withIdentity()` 取得，實作只負責轉換與計分，不要自行查詢資料庫。
- 呼叫外部 API 會產生費用，並需要新的 secret（AGENTS.md 第 6 節：先問人）。段落文字會送到外部服務，機密段落是否可以送出也要先確認。
- 向量要持久化時（避免每次載入都重算），新增資料表屬於 migration（高風險），並要為它設定 RLS，讓看不到段落的身分也看不到它的向量。
- 換實作後重跑 `app/src/retrieval/scenarios.target.test.ts` 與 `app/tests/retrieval/leakage.test.ts`。
