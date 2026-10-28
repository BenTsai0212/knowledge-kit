// PDF：只呼叫取得文字內容的 API（getTextContent），不繪製頁面（ADR 0002；structure.test.ts 檢查）。
// PDF.js 與它的 worker 以動態 import 載入；worker 隨 build 打包成靜態檔，不從 CDN 載入。
import type { TextItem } from "pdfjs-dist/types/src/display/api";

type PdfJs = Pick<typeof import("pdfjs-dist"), "getDocument">;

async function loadPdfJs(): Promise<PdfJs> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

// 每頁的文字依 hasEOL 組成行，頁與頁之間以空行分隔；沒有文字的 PDF（掃描檔）回傳空字串
export async function extractPdfText(data: Uint8Array, load: () => Promise<PdfJs> = loadPdfJs): Promise<string> {
  const pdfjs = await load();
  // getDocument 會轉移 data 的所有權，所以傳入複本
  const task = pdfjs.getDocument({ data: data.slice() });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const items = content.items.filter((item): item is TextItem => "str" in item);
      pages.push(items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join(""));
    }
    return pages.join("\n\n");
  } finally {
    // 結束 worker 中這份文件的工作
    await task.destroy();
  }
}
