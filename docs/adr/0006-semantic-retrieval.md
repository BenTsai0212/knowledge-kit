# ADR 0006：語意向量檢索的做法

- 狀態：Accepted（2026-11-09，人工量測回填後，#163）
- 日期：2026-11-04
- 決定者：@BenTsai0212
- 相關：#126（計畫與 `## 決定`）、#163（導入，計畫與 `## 決定`）、Epic #93 第 11 項、[評估報告](../evals/semantic-retrieval-2026-11.md)、ADR 0002（動態 import）、ADR 0004（固定版本＋SHA-256）、ADR 0005（線上 demo）

## 背景

`keyword-hash` 不支援跨語言，也不懂同義詞（`docs/retrieval.md`「限制」）。所以每種語言都要有自己的答案段落，v2 的多語言（第 12、13 項）會讓資料集的份量跟著語言數增加。

換法是替換 `VectorProvider`，檢索、問答與權限的程式不變。#126 在 verify 分支量測了兩個瀏覽器內的多語模型。

## 選項

1. **A1**：`multilingual-e5-small`（q8），以 transformers.js 在瀏覽器中執行。
2. **A2**：`paraphrase-multilingual-MiniLM-L12-v2`（q8），執行方式同上。
3. **B**：外部 embedding API，經 Worker 轉發。
4. **C**：自架模型。
5. **維持 `keyword-hash`**，跨語言靠每種語言各寫一份段落。

## 決定

- **採用 A1**，作為可選的 provider `multilingual-e5-small`（#163 導入，[docs/retrieval.md](../retrieval.md)「語意向量」）。客戶需要跨語言查詢（需求確認清單 D2）時，在 `client.json` 的 `retrieval.provider` 選用。
- **`keyword-hash` 保留為預設**，也是降級選項：模型下載或初始化失敗時改用它，並在畫面上提示（文字放 `client/i18n/`）。
- **向量在載入時於記憶體計算**，沿用 retriever 的快取，不新增資料表與 migration。
- **模型檔不放進 `dist/`**：q8 模型約 118 MB，超過 Cloudflare 靜態檔的單檔上限（25 MiB，導入前查證）。
  - 改從 Hugging Face 的固定 commit 下載。
  - 下載後由程式比對 SHA-256，再交給 ONNX Runtime；transformers.js 本身不驗證雜湊。
  - 以 Cache Storage 快取。
- **WASM 自己提供**：transformers.js 預設從 jsDelivr 載入 WASM。改以 `wasmPaths` 指到 `dist/`，選用不超過單檔上限的版本（`ort-wasm-simd-threaded.wasm`，14,264,838 bytes），供應鏈只多 Hugging Face 一處。
  - 這個版本不含 asyncify，**只跑 wasm 後端，不支援 WebGPU**（WebGPU 後端需要 asyncify／JSEP 版，預設的 asyncify 版 26,861,777 bytes 超過上限）。不另外提供 JSEP 版（#163 決定 5）。
  - 多執行緒需要 `crossOriginIsolated`（COOP／COEP 標頭），本站沒有設定，所以以單執行緒執行（`numThreads = 1`）。
- **接口**：`embed(texts)` 改為能區分查詢與段落（e5 要加不同前綴），例如 `embed(texts, kind)`。`similarity()` 把負的 cosine 截到 0。
- **設定**：A1 的 `minScore` 預設 0.7，`topK` 維持 5（`providers.ts` 的 `RETRIEVAL_DEFAULTS`，#163 決定 2）。0.7 不擋掉任何答案段落，但**本機拒答幾乎不起作用，拒答依賴模型**：評測台的 58 題都有段落超過 0.7，全部呼叫問答，本機拒答 0 題；完全無關的 5 題（`unrelated`）與其他 12 題拒答題都由模型正確拒答（拒答 17/17）。分數擠在 0.7～0.9 的原因見報告的「分數分布」。
- **載入方式**：模型與套件以動態 import 載入（同 ADR 0002），不使用的客戶不受影響。

## 理由

- 跨語言題的答案段落進前 5 名，A1 是 18/19，`keyword-hash` 是 10/19。同義詞題 6/6（`keyword-hash` 5/6），既有題目沒有變差。權限滲漏是 0。
- 導入後以評測台跑完整題庫（58 題，瀏覽器、main `e7e385d`）：引用 40/41、答案 41/41、拒答 17/17、權限滲漏 0/58，跨語言 19 題與同義詞 6 題的答案全部正確（[報告](../evals/semantic-retrieval-2026-11.md)「評測台（A1）」）。
- 段落不離開瀏覽器，與資料安全說明一致；不需要 secret，也沒有呼叫費用。

## 捨棄的選項

- **A2**：跨語言 @5 與 A1 相近，但 @1 與同義詞較差。最大長度只有 128 tokens，較長的段落會被截斷；檔案大小與 A1 相同。
- **B**：所有段落（含機密等級）都要送到供應商，與「資料不出瀏覽器」衝突；還需要 secret 或 binding，並產生用量費用。
- **C**：v1 沒有伺服器。
- **維持 `keyword-hash`**：每多一種語言，所有答案段落都要翻譯一份；換句話說的問題也找不到。

## 後果

- **好處**：
  - 文件只有一種語言時，也能以其他語言發問。
  - 第 12 項（泰文）可以先用 A1 處理跨語言：model card 列有 `th`。
- **代價**：
  - 首次載入要下載約 143 MiB（模型 135,392,183 bytes＋自己提供的 WASM 14,289,219 bytes，不含 JS），不適合當預設，也不適合線上 demo 的預設設定。
  - **第一次提問要等很久**：瀏覽器實測（Chrome 155、macOS）無快取時第一次提問約 50 秒（`firstQuestionMs` 49,642 ms，幾乎都是下載模型檔，`downloadMB` 129.1，即 135,392,183 bytes），有快取時約 1.7 秒。等待期間問答頁與評測台顯示「模型下載中」的提示與進度（#171，[docs/retrieval.md](../retrieval.md)「準備中的提示」）。
  - **執行時記憶體增加**：瀏覽器實測的分頁記憶體約 740 MB（Chrome 工作管理員，有快取的量測之後；JS heap 約 370 MB）。Heap snapshot 713 MB 中 `JSArrayBuffer` 佔 673 MB（94%），推測同一份模型 bytes 保留了數份（驗證後的 bytes、交給 transformers.js 的 Response、ONNX Runtime 內部），可作為日後減少記憶體的方向。Node 的 wasm 後端 RSS 最高約 1.3 GB（含 Node 版 transformers.js，是上限）。
  - 新增相依套件 `@huggingface/transformers` 4.3.2（含 `onnxruntime-web`、`onnxruntime-node`、`sharp`），供應鏈與更新的負擔都增加。
  - `onnxruntime-web` 是 transformers.js 4.3.2 指定的**開發版** `1.31.0-dev.20260914-8d85527a0`，不是正式版；跟著 transformers.js 固定，不單獨升級。升級 transformers.js 時一併確認它指定的 `onnxruntime-web` 版本，以及 `ort-wasm-simd-threaded.wasm` 的大小與檔名（PR #165 的修正要求）。
  - 依賴 Hugging Face 的可用性；日後設定 CSP 時要放行它。
  - 本機拒答幾乎不起作用（評測台 58 題本機拒答 0 題），每題都會呼叫 `/api/ask`，拒答完全依賴模型。
- **後續工作**（#163）：
  - 已完成：接口、provider、下載與雜湊驗證、降級、`client.json` 的 Schema（PR #164～#166）；跨語言題、同義詞題與完全無關題併入題庫與驗收指標，瀏覽器量測頁（[docs/retrieval.md](../retrieval.md)「瀏覽器量測」）。
  - 人工量測（瀏覽器量測、評測台、降級提示、模型授權）已回填報告與本 ADR，改為 Accepted。
  - 已完成：問答頁與評測台的「模型下載中」提示與進度（#171）。
  - 未做：本機拒答改用相對門檻等做法（報告「分數分布」）。
- **重新檢討的條件**：
  - 出現檔案小於單檔上限、品質相當的多語模型，可隨 `dist/` 提供。
  - 段落數增加到載入時重算太慢（Node wasm：430 段約 4 秒）：改為 build 時預先計算參考資料集，或存進資料庫（需 migration 與 RLS）。
  - 客戶同意段落送到外部，或正式系統有伺服器（重新比較 B、C）。
  - Cloudflare 的單檔上限改變。

## 改為 Accepted 前

PR #128 審查留下的 4 點（#163），已全部解決：

| | 項目 | 結果 |
| --- | --- | --- |
| 1 | 「本機拒答只擋明顯無關的問題」沒有數據 | 以評測台量測：58 題全部有段落超過 `minScore` 0.7，本機拒答 0 題，完全無關的 5 題也由模型拒答。「設定」一項改寫為「本機拒答幾乎不起作用，拒答依賴模型」 |
| 2 | 記憶體：ADR 寫「增加數百 MB」，報告中 wasm 最高約 1.3 GB | 瀏覽器實測分頁約 740 MB（JS heap 約 370 MB，ArrayBuffer 佔 heap snapshot 的 94%），寫進「代價」 |
| 3 | 不含 asyncify 的 WASM 對 WebGPU 與多執行緒的影響 | 只跑 wasm、單執行緒、不支援 WebGPU（#163 決定 5），見「決定」的 WASM 一項。WebGPU 量測不適用 |
| 4 | 轉換版模型（ONNX）的授權 | 轉換版 `Xenova/multilingual-e5-small`（commit `761b726dd34fb83930e26aab4e9ac3899aa1fa78`）沒有另標授權（model API 的 `tags` 與 `cardData` 沒有 `license`），model card 寫明 `base_model: intfloat/multilingual-e5-small`，是上游的 ONNX 權重。上游標示 `license:mit`，所以**依上游的 MIT 使用**。轉換版日後若另標授權，升級固定 commit 時重新確認（人以瀏覽器確認，#163） |

降級提示也已在瀏覽器確認：擋下 `huggingface.co` 並刪除模型的 Cache Storage 後重新整理，問答頁顯示降級提示，同語言的問題仍能以 `keyword-hash` 回答。
