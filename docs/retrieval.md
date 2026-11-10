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

實作可能要先下載模型才能使用，所以 `createProvider()` 回傳 Promise（未登記的值在呼叫時就拋錯），內容是實作、檢索參數（`topK`、`minScore`）與降級原因（見[降級](#降級)）。`openRetriever()` 不等待，立即回傳 retriever；第一次 `retrieve()` 時才等實作準備好，準備失敗時由 `retrieve()` 拋出。App 的問答、比對與評測台共用同一個 `createProvider()` 的結果，語意模型只下載、初始化一次。

## 設定

設定在 `client.json` 的 `retrieval`，欄位與預設值見 [docs/client-config.md](client-config.md#clientjson)：

| 欄位 | 預設值 | 意思 |
| --- | --- | --- |
| `provider` | `keyword-hash` | 使用哪個實作：`keyword-hash` 或 `multilingual-e5-small` |
| `topK` | 5 | 回傳前幾名 |
| `minScore` | `keyword-hash` 0.1、`multilingual-e5-small` 0.7 | 最低分數門檻 |

省略 `topK`、`minScore` 時依 `provider` 補上（`providers.ts` 的 `RETRIEVAL_DEFAULTS`，#163 決定 2）：兩者的分數分布不同，語意向量的分數擠在 0.7～0.9，0.7 不擋掉任何答案段落（[評估報告](evals/semantic-retrieval-2026-11.md)「分數分布與 `minScore`、`topK`」）。

`keyword-hash` 預設值的依據：以參考資料集測試，7 題預設問題中，與問題同語言的答案段落最差排第 2 名，分數都在 0.23 以上。0.1 的門檻用來排除只有零星共同字元的段落。

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
2. 不以空白分詞的語言（例如日文、泰文）：只用 `keyword-hash` 時，在 `scripts.ts` 的 `SCRIPTS` 加上該文字類別，選擇 `bigram` 或 `segmenter`；需要時在 `stopwords.ts` 加上停用詞。
3. 句尾標點或換行相連的方式不同時，修改 `scripts.ts` 的 `SENTENCE_ENDS`、`FULLWIDTH_PUNCTUATION` 或類別的 `joinsWithoutSpace`。
4. 執行 `npm run check:clients <名稱>`：`app/src/retrieval/scenarios.target.test.ts` 以該客戶的每種語言檢索預設問題，同語言的答案段落要在前 K 名內。選用語意向量的客戶也以 `keyword-hash` 檢查（[docs/client-config.md](client-config.md)「客戶檢查」）。

**日文的規則與實測**（#83）：以暫時的客戶 `clients/lang-ja/`（參考情境加上 `ja`：日文翻譯檔、實體的日文名稱、4 份日文文件、預設問題與 4 題日文題庫）驗證，只改了客戶資料夾與語言模組（`scripts.ts`、`stopwords.ts`）；暫時客戶不放進 repo（#77 決定 7）。

- 不加假名規則時，假名併入「其他文字」，連續的假名成為一個詞（例如「のマネージャーは」），日文問題靠漢字的雙字組仍排第 1，但分數偏低。
- 片假名以 `word`、平假名以 `bigram` 加日文停用字（採用）：日文的 7 題預設問題與 3 題作答題，答案段落都排第 1，最低分數 0.407。
- 假名改用 `segmenter`（`Intl.Segmenter` 的 `ja`）：同樣都排第 1，但最低分數 0.265，而且結果隨 ICU 版本而不同，所以不採用。
- 參考情境 `client/` 沒有假名，切詞與分數不變。

## 語意向量：`multilingual-e5-small`

依 [ADR 0006](adr/0006-semantic-retrieval.md) 導入的可選實作（#163），程式在 `app/src/retrieval/semantic/`。`client.json` 寫 `"retrieval": { "provider": "multilingual-e5-small" }` 就能選用；範例客戶與線上 demo 維持 `keyword-hash`。`PROVIDERS` 以動態 import 載入這個實作，沒選用的客戶不會下載它的程式（`dist/assets/` 中有它的檔案，但不會被請求）。題庫的跨語言、同義詞與完全無關題見[評測](#評測)，瀏覽器的量測見[瀏覽器量測](#瀏覽器量測)。

| 檔案 | 內容 |
| --- | --- |
| `model-files.ts` | 模型 `Xenova/multilingual-e5-small`（q8）的固定 commit，以及每個檔案的大小與 SHA-256。不讓 `client.json` 設定，避免繞過固定版本 |
| `download.ts` | `loadVerifiedFiles()`：從 `https://huggingface.co/<模型>/resolve/<commit>/<檔案>` 下載，比對大小與 SHA-256 後才交出；以 Cache Storage 快取（名稱含 commit）。快取中的檔案雜湊不符時刪除後重下；下載的檔案不符、HTTP 錯誤或有檔案未登記 SHA-256 時拋出 `ModelLoadError`，不寫入快取 |
| `runtime.ts` | 以 transformers.js 執行模型；全 app 只有這裡載入 `@huggingface/transformers`，而且以動態 import 載入（ADR 0002，`multilingual-e5-small.test.ts` 檢查）。模型檔只從驗證過的檔案取得：關閉遠端下載與它自己的快取，`env.fetch` 一律回 404。同一份驗證過的 bytes 同時以固定 commit 與 `main` 的網址回應，因為 transformers.js 4.3.2 的 `pipeline()` 有些路徑不帶 `revision`、改查 `main`（#168，升級時重新確認）；只回應 `model-files.ts` 登記過的檔案，其他 revision 與檔案查不到。以真正的 transformers.js 跑到 `pipeline()` 讀完設定與 tokenizer 的測試在 `runtime.test.ts` |
| `multilingual-e5-small.ts` | `createE5Provider()`：建立時下載並初始化，失敗時由回傳的 Promise 拋出。問題加 `query: `、段落加 `passage: ` 前綴，每批 16 筆；向量已正規化，相似度是內積，負值截到 0 |

**WASM**：ONNX Runtime 的 WASM 自己提供，不從 jsDelivr 載入（`scripts/ort-wasm.mjs`）。

- 用不含 asyncify 的 `ort-wasm-simd-threaded.wasm`（約 14 MB）與對應的 `.mjs`。預設的 asyncify 版超過 Cloudflare 靜態檔的單檔上限（25 MiB）。
- 這個版本只支援 wasm 後端，不支援 WebGPU；本站沒有 COOP／COEP 標頭，所以以單執行緒執行（#163 決定 5）。
- `npm run build` 只在選定客戶的 `retrieval.provider` 是語意向量時，把兩個檔案複製到 `dist/ort/`；單檔超過 25 MiB 時 build 失敗。`npm run dev` 一律以 `/ort/<檔名>` 提供。
- `vite.config.ts` 讓 `onnxruntime-web` 解析成不內含 WASM 的版本（`onnxruntime-web-use-extern-wasm` 條件），否則 build 會把 asyncify 版打包進 `dist/assets/`。

**相依套件**：`@huggingface/transformers` 固定 4.3.2。它帶進的 `onnxruntime-node` 只在 Node 使用，app 用不到；它在 linux/x64 安裝時會從 NuGet 下載 CUDA，CI 以 `ONNXRUNTIME_NODE_INSTALL=skip` 略過（[docs/testing.md](testing.md)「CI 的 job」），在 Linux 開發時也可以設定同一個環境變數。

測試不下載模型：下載與驗證以假的 `fetch`、Cache Storage 與 bytes 測試（`download.test.ts`），實作以注入的假模型測試（`multilingual-e5-small.test.ts`、`providers.test.ts`）。

### 準備中的提示

語意向量無快取時第一次提問約 50 秒，幾乎都在下載約 129 MB 的模型檔（ADR 0006「代價」），所以準備期間問答頁與評測台顯示提示（`app/src/ui/RetrievalNotice.tsx`，判斷是 `retrieval-notice.ts` 的純函式 `retrievalNotice()`）：

| 狀態 | 提示 |
| --- | --- |
| 準備中，需要下載 | 「下載中」與進度：已下載／總大小（MB，1024 × 1024 bytes，小數一位）與進度條 |
| 準備中，從快取載入，或下載完成後初始化 | 「載入中」，不顯示進度 |
| 準備好 | 不顯示 |
| 降級 | 改顯示降級提示（見[降級](#降級)） |

- 進度由 `download.ts` 的 `loadVerifiedFiles()` 以 `onProgress` 回報 `{ loaded, total }`：`total` 是 `model-files.ts` 登記大小的合計，`loaded` 含從快取讀到的檔案。開始連網時先回報一次，之後逐段讀取回應、每收到一段回報一次；下載的檔案超過登記大小時，進度不超過該檔的大小。全部從快取取得時不回報，畫面因此只顯示「載入中」。
- 逐段讀取取得的 bytes 與 `arrayBuffer()` 相同，大小與 SHA-256 驗證、快取與固定 commit 都不變。
- `createProvider(config, factories, onProgress)` 把回呼交給實作（`ProviderFactory` 的參數）；App 只在顯示的數字改變時更新畫面。
- 只有 `preparesModel()`（`providers.ts`）為真的實作顯示準備中的提示；`keyword-hash` 的客戶畫面不變。
- 文字是 `client/i18n/` 的 `modelLoadingTitle`、`modelDownloadingTitle`、`modelDownloadProgress`（參數 `{loaded}`、`{total}`）與 `modelPreparing`。測試以注入的假下載回報進度（`download.test.ts`、`providers.test.ts`），畫面以 `renderToStaticMarkup` 檢查（`app/src/ui/retrieval-notice.test.ts`）。

### 降級

語意向量準備失敗時，`createProvider()` 改用 `keyword-hash`，不讓問答停擺：

| 原因（`FallbackReason`） | 情形 |
| --- | --- |
| `download` | 模型檔 HTTP 錯誤，或連不上（離線、被擋） |
| `integrity` | 下載的檔案大小或 SHA-256 與 `model-files.ts` 不符，或有檔案未登記 SHA-256 |
| `init` | 其他失敗：載入程式、Cache Storage 或 ONNX Runtime 初始化失敗 |

- 降級後 `minScore` 改用 `keyword-hash` 的預設值 0.1（語意向量的 0.7 對 `keyword-hash` 太高，幾乎每題都會拒答），`topK` 不變。
- 評測台的設定表單同樣以降級後的值為預設值：provider 準備好後，人還沒改過的欄位換成 `ActiveProvider.options`，否則評測會以 0.7 為門檻、幾乎每題拒答（#178，見 [evals.md「畫面」](evals.md#畫面)）。
- 問答頁與評測台顯示提示（`RetrievalFallbackNotice`，經 `RetrievalNotice` 顯示；文字是 `client/i18n/` 的 `retrievalFallbackTitle` 與依原因的 `retrievalFallback`）；錯誤本身只寫到 `console.warn`。
- `keyword-hash` 本身不降級。測試以假的 `fetch` 與會失敗的模型確認每種原因都會降級（`providers.test.ts`），並確認降級後的檢索結果與 `keyword-hash` 的客戶相同（`retrieve.test.ts`）。

### 評測

題庫（`client/evals/questions.json`）有只在語意向量有意義的題目（[docs/evals.md](evals.md)「跨語言、同義詞與完全無關的題目」）：

- **跨語言**（19 題，`cross-language`）：以 `passageLanguage` 只檢索另一種語言的段落，等同「這個事實只有該語言的段落」，不必另建一份資料集。都標記 `requires: "semantic"`。
- **同義詞**（6 題，`synonym`）：問題用段落裡沒有的說法，只檢索同語言的段落。`keyword-hash` 以預設設定找不到答案段落的 2 題標記 `requires: "semantic"`，其餘 4 題在 `keyword-hash` 照常計分。
- **完全無關**（5 題，`unrelated`）：食譜、程式語法、比賽結果等，用來驗證 `minScore`。`keyword-hash` 檢索不到段落，在本機拒答。

評測台在 `keyword-hash`（包括降級）時把 `requires: "semantic"` 的題目顯示為不適用、不計入分母，所以範例客戶的結果與門檻不變。`app/src/evals/run.test.ts` 以 `keyword-hash` 檢查標記與實際結果一致。語意向量的分數在 CI 拿不到（不下載模型），由人以本機的 A1 客戶設定在評測台執行（見下一節）；2026-11 的結果在[評估報告](evals/semantic-retrieval-2026-11.md)「評測台（A1）」：本機拒答 0 題，拒答依賴模型。

### 瀏覽器量測

`app/dev/semantic-measure.html` 是開發專用的量測頁：只在 `npm run dev` 提供（`/dev/semantic-measure.html`），build 只以 `app/index.html` 為入口，`dist/` 不含它。頁面使用正式的 `createE5Provider()`（同一套下載、SHA-256 驗證、Cache Storage 與自己提供的 WASM），按 `run` 輸出一行 JSON：

| 欄位 | 內容 |
| --- | --- |
| `firstQuestionMs` | 第一次提問要等多久：建立 provider（下載、驗證、初始化）＋轉全部段落＋轉問題，與問答頁的第一次提問相同 |
| `downloadMB` | 開始前不在 Cache Storage 的模型檔大小合計（快取中有的檔案不再下載） |
| `loadMs`、`passagesMs`、`firstQueryMs` | 上述三個階段各自的時間；段落是參考資料集的全部段落（`passages`） |
| `queryMs` | 之後一次查詢的平均（20 次） |
| `jsHeapMB` | `performance.memory`（只有 Chrome 有）；分頁的記憶體另看瀏覽器的工作管理員 |
| `cachedFiles`、`crossOriginIsolated`、`cores`、`userAgent` | 量測條件 |

`clear model cache` 刪除模型的 Cache Storage，用來量首次載入。

**本機的 A1 客戶設定**：人工以評測台跑語意向量的題目時，把參考情境複製到 `clients/local-<名稱>/`（`.gitignore` 排除 `clients/local-*/`，不進版本控制），把 `client.json` 的 `retrieval.provider` 改成 `multilingual-e5-small`，再以 `KK_CLIENT=local-<名稱> npm run dev` 啟動，打開 `/?tools=evals`（[docs/evals.md](evals.md)「開啟評測台」）。

## 向量快取

- 段落向量在第一次檢索時計算，存在 retriever 的記憶體快取中，鍵是段落 id。之後只要轉換問題。
- 快取不影響可見範圍：每次檢索都先經過 `withIdentity()`，只有 RLS 回傳的段落會被計分。快取中有別的身分看得到的段落，也不會被選進結果（`app/tests/retrieval/leakage.test.ts` 以交替身分測試）。
- **之後的上傳功能**：
  - 新增段落：新的 id 會在下次檢索時自動計算，不需處理。
  - 修改段落內容：快取以 id 為鍵，不會發現內容變了，修改時必須一併清掉該段的快取（或改以內容雜湊為鍵）。
- 快取不存進資料庫，所以不需要 migration。

## 限制

- **非語意**：只比對共同的詞與字元，不懂同義詞與換句話說。例如「主管」找不到只寫「經理」的段落，`vacation` 找不到只寫 `annual leave` 的段落。
- **不支援跨語言**：中文問題找不到只有英文的段落，反之亦然。參考資料集的每題預設問題在兩種語言都有答案段落（#26），所以 14 個檢查都能通過；需要跨語言時選用[語意向量](#語意向量multilingual-e5-small)（評估見[評估報告](evals/semantic-retrieval-2026-11.md)與 [ADR 0006](adr/0006-semantic-retrieval.md)）。
- **不以空白分詞、語言模組沒有規則的語言**（例如泰文）：這類文字併入「其他文字」，兩個空白之間的一整串成為一個詞，只剩 3 字元組能部分比對，`keyword-hash` 的檢索效果很差。需要時選用[語意向量](#語意向量multilingual-e5-small)，不必先改語言模組；只用 `keyword-hash` 時才為它在語言模組加上規則（[新增語言步驟](playbook/add-language.md)第 3 節）。本 template 不內建泰文的規則（[RFC 0002](rfcs/0002-public-release.md)「修訂紀錄」）。
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
2. 在 `providers.ts` 的 `PROVIDERS` 登記建立實作的函式（可以是非同步，例如先下載模型；失敗時自動降級到 `keyword-hash`），並在 `RETRIEVAL_DEFAULTS` 登記省略 `topK`、`minScore` 時的值。
3. 在 `client/schema/client.schema.json` 的 `retrieval.provider` 列舉，以及 `app/src/client/types.ts` 的 `ProviderId`，加上同名的值。
4. 改 `client.json` 的 `retrieval.provider`；分數分布不同時，一併調整 `minScore` 與 `topK`。

注意：

- `retrieve.ts`、問答與資料層的程式不需要修改；除了 `providers.ts`，不要在其他地方匯入具體實作（結構測試會失敗）。
- 段落一律經過 `withIdentity()` 取得，實作只負責轉換與計分，不要自行查詢資料庫。
- 呼叫外部 API 會產生費用，並需要新的 secret（AGENTS.md 第 6 節：先問人）。段落文字會送到外部服務，機密段落是否可以送出也要先確認。
- 向量要持久化時（避免每次載入都重算），新增資料表屬於 migration（高風險），並要為它設定 RLS，讓看不到段落的身分也看不到它的向量。
- 換實作後重跑 `app/src/retrieval/scenarios.target.test.ts` 與 `app/tests/retrieval/leakage.test.ts`。
