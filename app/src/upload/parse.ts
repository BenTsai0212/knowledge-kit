// 上傳文件的解析：依副檔名擷取純文字，並檢查上限（docs/upload.md）。檔案只在瀏覽器中解析，不上傳到伺服器。
// PDF 與 Word 的套件以動態 import 載入，只在上傳時下載（ADR 0002）。
import { extractDocxText } from "./docx";
import { stripMarkdown } from "./markdown";
import { extractPdfText } from "./pdf";

// #38 決定 3：保護瀏覽器的上限，放在程式中的常數
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 50_000;
export const MAX_PASSAGES = 500;

export type Format = "text" | "markdown" | "pdf" | "docx";

export type ParseFailure =
  | "unsupported" // 不支援的副檔名
  | "too_large" // 檔案超過 MAX_FILE_BYTES
  | "too_long" // 擷取後超過 MAX_TEXT_CHARS，或切段後超過 MAX_PASSAGES
  | "empty" // 沒有任何文字
  | "no_text" // PDF 沒有可擷取的文字（例如掃描檔）；不做 OCR
  | "failed"; // 檔案損毀或解析失敗

export class ParseError extends Error {
  constructor(readonly reason: ParseFailure) {
    super(`無法讀取上傳的文件：${reason}`);
  }
}

const EXTENSIONS: Record<string, Format> = { txt: "text", md: "markdown", markdown: "markdown", pdf: "pdf", docx: "docx" };

export function formatOf(fileName: string): Format | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return Object.hasOwn(EXTENSIONS, ext) ? EXTENSIONS[ext] : null;
}

// PDF 與 Word 的擷取函式；Vitest（Node）中改用 PDF.js 的 legacy 版本
export interface Extractors {
  pdf: (data: Uint8Array) => Promise<string>;
  docx: (data: Uint8Array) => Promise<string>;
}

const BROWSER: Extractors = { pdf: (data) => extractPdfText(data), docx: (data) => extractDocxText(data) };

// 直接貼上的文字以 text 處理
export async function extractText(data: Uint8Array, format: Format, extractors: Extractors = BROWSER): Promise<string> {
  if (data.byteLength > MAX_FILE_BYTES) throw new ParseError("too_large");
  let text: string;
  try {
    if (format === "pdf") text = await extractors.pdf(data);
    else if (format === "docx") text = await extractors.docx(data);
    else {
      const raw = new TextDecoder().decode(data);
      text = format === "markdown" ? stripMarkdown(raw) : raw;
    }
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError("failed");
  }
  text = text.replace(/\r\n?/g, "\n").trim();
  if (text === "") throw new ParseError(format === "pdf" ? "no_text" : "empty");
  if (text.length > MAX_TEXT_CHARS) throw new ParseError("too_long");
  return text;
}
