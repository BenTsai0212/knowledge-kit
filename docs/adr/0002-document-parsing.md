# ADR 0002：上傳文件的解析套件

- 狀態：Proposed
- 日期：2026-10-28
- 決定者：@BenTsai0212
- 相關：#38（上傳文件）、ADR 0001（核准的套件）

## 背景

#38 讓使用者上傳純文字、Markdown、PDF 與 Word（.docx）文件，切成段落後立即可被問答與時間軸查到。純文字與 Markdown 不需要套件；PDF 與 .docx 需要解析。上傳內容只存在瀏覽器的記憶體資料庫，所以解析也在瀏覽器中進行。

## 選項

1. 新增 `pdfjs-dist`（Mozilla PDF.js）與 `mammoth`，在瀏覽器中擷取純文字。
2. 把檔案送到 Worker 或外部服務解析：檔案會離開瀏覽器，也需要新的伺服器端相依與費用。
3. 只支援純文字與 Markdown：不符合 #38 的已決定事項。

## 決定

選項 1：新增執行套件 `pdfjs-dist`、`mammoth`，只用來在瀏覽器中擷取上傳文件的純文字。

- **PDF**：只呼叫取得文字內容的 API（`getTextContent`），不繪製頁面。
  - pdfjs-dist 6.x 已移除 CVE-2024-4367 所在的 eval 路徑與 `isEvalSupported` 選項，以結構測試確認（#38 決定）：
    - `app/src/upload/structure.test.ts` 掃描安裝的 `build/pdf.mjs`、`build/pdf.worker.mjs`、`legacy/build/pdf.mjs`、`legacy/build/pdf.worker.mjs`，確認沒有 `eval(` 與 `Function(`；之後升級到重新加入 eval 的版本時，CI 失敗。
    - legacy 版內含 core-js 的 `globalThis` 後備寫法 `Function('return this')()`（固定字串，不是字型路徑），只放行這一段完全相同的寫法；瀏覽器使用的 `build/` 版本沒有任何例外。legacy 版只在 Vitest（Node）中使用。
    - 上傳模組不寫 `isEvalSupported`，避免誤以為有防護。
  - 使用 PDF.js 自己的 worker，以 Vite 的 `?url` 隨 build 打包成靜態檔，由 Cloudflare 靜態檔提供，不從 CDN 載入。
- **Word**：只用 `mammoth.extractRawText()`，不轉 HTML，不帶入圖片、連結、樣式。
- 兩者都只在上傳時以動態 import 載入，不影響只用問答、圖譜的人。
- 檔案只在瀏覽器中解析，不上傳到伺服器；只有擷取出的文字會在萃取時（#38 之後的 9b）送到模型。
- 限制檔案大小（10 MB）、擷取後的字數（50,000 字元）與段落數（500）；超過上限、空白文件，或 PDF 沒有可擷取的文字（掃描檔），顯示固定訊息。不做 OCR。
- 安裝：以 `npm install pdfjs-dist mammoth` 照原樣執行，不另加參數，提交 lockfile。

## 後果

- **打包後的大小**（`npm run build`，#38 PR 2 實測）：

  | 檔案 | 大小 | gzip | 下載時機 |
  | --- | --- | --- | --- |
  | PDF.js 主程式（chunk） | 430 KB | 129 KB | 上傳 PDF 時動態載入 |
  | PDF worker（靜態檔） | 1,264 KB | — | 同上，由 Cloudflare 靜態檔提供 |
  | mammoth（chunk） | 308 KB | 95 KB | 上傳 .docx 時動態載入 |

- **相依**：lockfile 新增 37 項，其中 12 項是 `@napi-rs/canvas` 各平台的選用二進位檔。`@napi-rs/canvas` 是 pdfjs-dist 的選用相依，npm 會一併安裝，但瀏覽器用不到。以 `npm audit` 追蹤（安裝時為 0），兩者與間接相依都沒有新的安裝時執行腳本。
- **瀏覽器相容**：不需要 Node 內建模組的 polyfill；mammoth 以自己 `package.json` 的 `browser` 欄位替換用到 Node 模組的檔案。瀏覽器版的 mammoth 只接受 `arrayBuffer`，Node 版只接受 `buffer`，測試中在 loader 轉換。
- **限制**：複雜版面的 PDF 文字順序可能不理想；PDF 通常沒有空行，所以依句子切段。中文 PDF 需要內嵌字型，自動測試的 fixture 只有英文，中文 PDF 以人工驗收。
- 決策中心查證（2026-10-28）：`pdfjs-dist` 6.4.299（Apache-2.0）、`mammoth` 1.13.0（BSD-2-Clause）。
