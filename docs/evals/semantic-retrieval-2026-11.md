# 語意向量評估報告（2026-11）

- Issue：#126（Epic #93 第 11 項）；計畫與 `## 決定` 在 #126 的留言
- 決策草稿：[ADR 0006](../adr/0006-semantic-retrieval.md)（Proposed）
- 量測程式：verify 分支 `verify/126-semantic-retrieval`（commit `e130f19`，不合併），`verify/semantic/` 與 `app/verify-semantic.*`
- main 的檢索行為與相依套件不變；本報告只是評估。

## 結論

- **建議 A1（`multilingual-e5-small`，q8）**，作為可選的 provider。`keyword-hash` 保留為預設與降級選項。
- 跨語言題答案段落進前 5 名：A1 是 18/19，`keyword-hash` 是 10/19。同義詞題 6/6，`keyword-hash` 是 5/6。既有題目都是 16/16，沒有變差。
- 權限滲漏：A1、A2 都是 0。
- **本機拒答不能只靠 `minScore`**：A1 的分數擠在 0.7～0.9，拒答題的最高分（0.902）高過答案段落的最低分（0.740）。`keyword-hash` 也有重疊（0.329 對 0），所以本機拒答本來就只擋得住一部分。拒答主要仍靠模型。
- **檔案太大，Worker 放不下**：q8 模型檔約 118 MB（另有 17 MB 的 tokenizer）。transformers.js 預設的 WASM（asyncify 版）是 26,861,777 bytes。兩者都超過 Cloudflare 靜態檔的單檔上限（25 MiB = 26,214,400 bytes；本次未能連線查證文件，導入前再確認）。
- 首次載入的下載量約 155 MiB。換算時間：10 Mbps 約 130 秒，50 Mbps 約 26 秒。所以只適合「客戶需要跨語言」時選用，不適合當預設。

## 量測環境

- 硬體：Apple M5（10 核心）、32 GB；macOS 26.5.1、Node v24.22.0。
- 套件：`@huggingface/transformers` 4.3.2（Apache-2.0）、`onnxruntime-node` 1.30.0（MIT）、`onnxruntime-web` 1.31.0-dev.20260914-8d85527a0（MIT）。
- 品質：以 `createRetriever()` 搭配 PGlite 參考資料集（43 段）、不限名次、門檻 0 執行，結果經 `withIdentity()` 的 RLS 篩選，與正式檢索相同。不呼叫 `/api/ask`。
- 模型：兩個都用 q8（`onnx/model_quantized.onnx`）。cpu 後端（onnxruntime-node）與 wasm 後端（onnxruntime-web 在 Node 執行）的向量 cosine 為 0.996（A1）、0.994（A2），品質數字以 cpu 後端量測。

## 候選

| | A1 | A2 |
| --- | --- | --- |
| 模型 | `intfloat/multilingual-e5-small`（轉換版 `Xenova/multilingual-e5-small`） | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`（轉換版 `Xenova/…`） |
| 授權 | 上游 MIT。轉換版未另標授權，導入前確認 | 上游 Apache-2.0。轉換版同左 |
| 支援語言 | model card：xlm-roberta 的 100 種語言（metadata 列 94 種，含 `zh`、`th`）；低資源語言品質可能下降 | metadata 列 50 種（含 `zh-cn`、`zh-tw`、`th`） |
| 最大長度 | 512 tokens | 128 tokens（較長的段落會被截斷） |
| 向量維度 | 384 | 384 |
| 前綴 | 查詢 `query: `、段落 `passage: ` | 不需要 |
| 固定版本 | `761b726dd34fb83930e26aab4e9ac3899aa1fa78` | `2c4055b12046f11709e9df2c122e59ffbdc2f900` |

模型檔（bytes，取自 Hugging Face API；sha256 以 API 的 LFS 雜湊驗證，下載後重新計算確認相符）：

| 檔案 | A1 | A2 |
| --- | --- | --- |
| `onnx/model.onnx`（fp32） | 470,268,533 | 470,268,510 |
| `onnx/model_fp16.onnx` | 235,336,732 | 235,336,673 |
| `onnx/model_quantized.onnx`（q8，量測用） | 118,308,185（`f80102d3…6f98c193`） | 118,308,126（`66fc00f5…6cc4ebc`） |
| `onnx/model_q4.onnx` | 398,649,233 | 398,649,249 |
| `tokenizer.json` | 17,082,730（`0b44a9d7…14ebdf4c39`） | 17,082,913（`b60b6b43…3686fa441`） |
| 其他（`config.json` 等 3 個） | 1,268 | 1,449 |

- q4 版比 q8 大（只量化部分權重），所以 q8 是最小的版本。
- 完整的 SHA-256 在 verify 分支的 `verify/semantic/models.mjs`。下載以 `download.mjs` 固定 commit，比對大小與雜湊，不符就失敗。

套件的查證（同 ADR 0004 的方式，只在 verify 分支安裝）：

- `npm install --ignore-scripts --save-exact` 之後 `npm audit`：0 vulnerabilities。
- 有安裝腳本的只有 `onnxruntime-node`（`postinstall: node ./script/install`）。腳本只在需要時下載 CUDA 的執行檔，macOS 的執行檔已隨套件附上，所以略過它也能執行。
- `sharp`（Apache-2.0）是相依套件，用不到，但會一起安裝。

## 評測題

題目定義在 verify 分支的 `verify/semantic/questions.ts`，共 58 題。

| 題型 | 題數 | 怎麼出 |
| --- | --- | --- |
| 既有 | 28（答案題 16、拒答題 12） | `client/evals/questions.json` 的全部題目，照原樣 |
| 跨語言 中→英 | 9 | 中文發問，只取英文段落 |
| 跨語言 英→中 | 10 | 英文發問，只取中文段落 |
| 同義詞 | 6（中英各 3） | 問題用段落裡沒有的說法（「招聘」對「招募」、`vacation` 對 `annual leave`）；只取同語言的段落 |
| 主題相近的拒答 | 5 | 例如保固期、停車位、育嬰假，資料集沒有答案 |

- **跨語言的資料**：計畫原本要建 `clients/verify-semantic/`、刪掉一種語言的段落。實際改用檢索既有的 `RetrieveOptions.language`，只取另一種語言的段落。效果等同「這個事實只有該語言的段落」，而且不必另維護一份資料集與跨檔引用。
- 名稱只沿用參考情境既有的虛構名稱，沒有新增。

## 檢索品質

@k 指答案段落（任一段）在前 k 名內的題數。MRR 依第一個答案段落的名次計算。

| 題型 | 題數 | `keyword-hash` @1／@3／@5（MRR） | A1 @1／@3／@5（MRR） | A2 @1／@3／@5（MRR） |
| --- | --- | --- | --- | --- |
| 既有 | 16 | 16／16／16（1.000） | 16／16／16（1.000） | 16／16／16（1.000） |
| 跨語言 中→英 | 9 | 2／3／6（0.394） | 6／8／9（0.781） | 5／8／8（0.736） |
| 跨語言 英→中 | 10 | 2／3／4（0.340） | 6／8／9（0.723） | 7／8／10（0.783） |
| 同義詞 | 6 | 4／5／5（0.769） | 6／6／6（1.000） | 4／6／6（0.833） |

- 第 5 名以外的題目：
  - `keyword-hash`：10 題，例如 `y-warehouse-team` 排第 23 名。
  - A1：只有 `y-over-budget`（第 7 名，排在前面的是另一個專案的預算段落）。
  - A2：只有 `x-vendor`（第 8 名）。
- A1 與 A2 的跨語言 @5 相近。A1 的中→英與同義詞較好，最大長度也較長（512 對 128 tokens），所以建議 A1。

## 分數分布與 `minScore`、`topK`

| | 答案段落分數（最低／中位，跨語言 中→英） | 拒答題 17 題的最高分（最高／最低） |
| --- | --- | --- |
| `keyword-hash` | 0.000／0.014 | 0.329／0.050 |
| A1 | 0.740／0.773 | 0.902／0.714 |
| A2 | 0.226／0.599 | 0.565／0.099 |

以全部 41 題答案題、17 題拒答題計算，不同 `minScore` 的影響：

| `minScore` | `keyword-hash`：答案被擋／拒答仍有段落 | A1 | A2 |
| --- | --- | --- | --- |
| 0.1（現在的設定） | 19／11 | 0／17 | 0／16 |
| 0.3 | 27／1 | 0／17 | 1／15 |
| 0.5 | 35／0 | 0／17 | 8／3 |
| 0.7 | 40／0 | 0／17 | 31／0 |
| 0.75 | 41／0 | 2／16 | 34／0 |
| 0.8 | 41／0 | 12／14 | 37／0 |

- 三者都沒有能同時「不擋答案、擋下拒答題」的門檻。A1 拒答題分數最高的是權限題（`bluewing-budget-staff` 0.902）：該身分看得到同專案的其他段落，主題很接近。
- **建議**：A1 的 `minScore` 設 0.7（答案題不受影響），本機拒答只擋明顯無關的問題，其餘交給模型拒答（與現在相同，`docs/qa.md`）。`topK` 維持 5，涵蓋 40/41 題；改成 8 可全部涵蓋，但 prompt 會變長，導入時再看評測台的結果決定。
- 要讓本機拒答有效，可在導入的 Issue 評估「相對門檻」，例如與第 1 名的差距，或與一組無關問題的分數比較。本次未量測。

## 權限滲漏

verify 分支的 `verify/semantic/leakage.verify.test.ts` 把 `app/tests/retrieval/leakage.test.ts` 與 `app/tests/evals/leakage.test.ts` 的檢查改用候選 provider：

| | 檢索：5 個身分 × 57 個查詢 × 2 種設定（預設；不限名次、門檻 0） | 評測：題庫 28 題（假的 `/api/ask`） | 反向驗證（忽略身分的資料層） |
| --- | --- | --- | --- |
| A1 | 滲漏 0 | 滲漏 0 | 抓得到 |
| A2 | 滲漏 0 | 滲漏 0 | 抓得到 |

這與預期相同：段落先經 RLS 篩選才計分，provider 換了也不影響。

## 效能（Node）

每個候選 × 每種後端各在獨立的 Node 行程執行（`verify/semantic/perf-one.ts`）。模型檔已在本機，不含下載時間。

| | 載入 | 43 段的向量 | 430 段（43 段重複 10 次） | 一次查詢 | RSS（啟動 → 載入後 → 最高） |
| --- | --- | --- | --- | --- | --- |
| A1 cpu | 253 ms | 121 ms | 1,060 ms | 2.6 ms | 111 → 676 → 761 MB |
| A1 wasm | 392 ms | 391 ms | 4,056 ms | 8.1 ms | 111 → 1,008 → 1,306 MB |
| A2 cpu | 322 ms | 109 ms | 1,069 ms | 2.6 ms | 111 → 693 → 752 MB |
| A2 wasm | 413 ms | 393 ms | 3,918 ms | 7.6 ms | 111 → 1,015 → 1,314 MB |

- wasm 的 RSS 也包含 transformers.js 的 Node 版（借用它的 tokenizer）。所以這是上限，瀏覽器分頁的記憶體要另外量測。
- 對照：`keyword-hash` 的一次檢索約 1.4 ms（`docs/retrieval.md`「限制」）。

**首次載入的下載量（換算值，以 A1 計，尚未在瀏覽器實測）**：

| 項目 | bytes |
| --- | --- |
| 模型（q8）＋tokenizer＋設定檔 | 135,392,183 |
| WASM（transformers.js 4.3.2 預設的 `ort-wasm-simd-threaded.asyncify.wasm`＋`.mjs`） | 26,914,834 |
| `transformers.web.min.js` | 456,110 |
| 合計 | 162,763,127（約 155 MiB） |

- 換算：10 Mbps 約 130 秒，50 Mbps 約 26 秒。`tokenizer.json` 若以壓縮傳輸會少一些；ONNX 檔壓縮效果不大。
- 不含 `asyncify` 的 `ort-wasm-simd-threaded.wasm` 是 14,264,838 bytes。

## 瀏覽器量測（待人工量測）

runner 不啟動瀏覽器，所以這部分列為人工待辦，只量 A1。#163 改用 main 上的量測頁，取代 verify 分支的 `/verify-semantic.html`；頁面使用正式的 provider（固定 commit 下載、SHA-256 驗證、Cache Storage 與自己提供的 WASM，[docs/retrieval.md](../retrieval.md)「瀏覽器量測」）。

1. 在 main 執行 `npm install`、`npm run dev`。
2. 開 `/dev/semantic-measure.html`，先按 `clear model cache`，再按 `run`：量首次載入（模型從 Hugging Face 下載）。
3. 不清快取再按一次 `run`：量第二次載入（從 Cache Storage 讀取）。
4. 記下頁面輸出的 JSON，以及瀏覽器工作管理員中該分頁的記憶體。

- 自己提供的 WASM 只跑 wasm 後端、單執行緒，不支援 WebGPU（#163 決定 5），所以不量 webgpu。

量測後回填下表：

| 瀏覽器／裝置 | 快取 | 下載量 | 第一次提問（`firstQuestionMs`） | 載入 | 43 段 | 一次查詢 | JS heap | 分頁記憶體 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| （待人工量測） | 無 | | | | | | | |
| （待人工量測） | 有 | | | | | | | |

### 評測台（A1）

以本機的 A1 客戶設定（`clients/local-<名稱>/`，不進版本控制）在評測台跑完整題庫（58 題），回填跨語言、同義詞與完全無關題的結果。完全無關題用來決定 ADR 0006 的本機拒答寫法：

| 題型 | 題數 | 引用正確 | 答案正確 | 正確拒答 | 在本機拒答（不呼叫 `/api/ask`） | 權限滲漏 |
| --- | --- | --- | --- | --- | --- | --- |
| 既有 | 28 | （待量測） | | | | |
| 跨語言 | 19 | | | — | — | |
| 同義詞 | 6 | | | — | — | |
| 完全無關 | 5 | — | — | | | |

## 其他做法（只做文字比較）

- **外部 API（B，經 Worker 轉發）**：依 #126 決定 D3，不實測。
  - 候選：Cloudflare Workers AI 的多語 embedding（AI binding，不需新 secret，但要改 `wrangler.jsonc`，有用量費用）、專門的 embedding 供應商（需要新的 API key secret）。
  - 費用估算：段落數 × 平均 token 數（載入時一次），加上每次提問的 token 數；要與 `/api/ask` 共用或另設每日上限。
  - 送出範圍：載入時要送所有段落，demo 中含機密等級。只送目前身分看得到的段落時，切換身分要再送一次。
  - 取捨：與 `docs/playbook/data-security.md`「資料不出瀏覽器」衝突；換來的是不必下載模型。
- **自架模型（C）**：v1 沒有伺服器。正式系統要讓資料留在客戶環境時再考慮，品質可選較大的模型。
- **靜態 embedding（例如 Model2Vec 系列）**：計算快，但多語版的模型檔也大，品質通常低於 transformer 模型。A1 已合格，不建議補測。
- **較大的模型（例如 `bge-m3`）**：品質較好，但模型檔大很多（fp32 約 2 GB），不適合在瀏覽器下載。
- **直接使用 `onnxruntime-web`、自己處理 tokenizer**：少一層相依，但要自己維護 tokenizer。verify 分支的 wasm 量測就是這種寫法（tokenizer 借用 transformers.js）。導入時可考慮，見 ADR 0006。
