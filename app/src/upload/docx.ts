// Word（.docx）：只用 mammoth 的 extractRawText()，不轉 HTML，不帶入圖片、連結與樣式（ADR 0002）。
// mammoth 以動態 import 載入，只在上傳時下載。
type Mammoth = Pick<typeof import("mammoth"), "extractRawText">;

const loadMammoth = async (): Promise<Mammoth> => (await import("mammoth")).default;

// 段落之間以空行分隔
export async function extractDocxText(data: Uint8Array, load: () => Promise<Mammoth> = loadMammoth): Promise<string> {
  const mammoth = await load();
  const result = await mammoth.extractRawText({ arrayBuffer: data.slice().buffer });
  return result.value;
}
