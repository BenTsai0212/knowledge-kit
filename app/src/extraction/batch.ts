// 分批：依段落順序裝入，直到 prompt 的長度達到 PROMPT_CHAR_BUDGET（算法與 Worker 相同），段落不跨批。
// 每份文件最多 maxBatches 批；超過的段落不萃取（docs/extraction.md）。
import { PROMPT_CHAR_BUDGET, promptChars } from "../qa/prompt";
import { extractionUserMessage } from "./prompt";

export interface PlannedBatches {
  // 每批的段落 id
  batches: string[][];
  // 沒有萃取的段落（超過批數上限），依原本的順序
  skipped: string[];
}

export function planBatches(passages: { id: string; content: string }[], system: string, maxBatches: number): PlannedBatches {
  const batches: { id: string; content: string }[][] = [];
  let current: { id: string; content: string }[] = [];
  const fits = (list: { content: string }[]) => promptChars({ system, user: extractionUserMessage(list) }) <= PROMPT_CHAR_BUDGET;
  let i = 0;
  for (; i < passages.length; i++) {
    const p = passages[i];
    if (fits([...current, p])) {
      current.push(p);
      continue;
    }
    if (current.length > 0) batches.push(current);
    if (batches.length === maxBatches) break;
    // 單一段落就超過預算時不萃取（上傳的段落最長 1,000 字元，不會發生）
    current = fits([p]) ? [p] : [];
  }
  if (i === passages.length && current.length > 0 && batches.length < maxBatches) batches.push(current);
  const planned = new Set(batches.flat().map((p) => p.id));
  return { batches: batches.map((b) => b.map((p) => p.id)), skipped: passages.filter((p) => !planned.has(p.id)).map((p) => p.id) };
}
