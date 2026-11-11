// 問答的逐句動態（#227，docs/design.md「動態」）：回答切成句子，引用標號歸到它前面的句子（句子升起後標號才彈出）。
import { sentencePieces } from "../language/text";
import { splitCitations, type Segment } from "../qa/citations";
import { staggerIndex } from "./motion";

export function answerSentences(text: string): Segment[][] {
  const sentences: Segment[][] = [];
  let closed = true;
  for (const segment of splitCitations(text)) {
    if (!("text" in segment)) {
      if (sentences.length === 0) sentences.push([]);
      sentences.at(-1)!.push(segment);
      continue;
    }
    for (const piece of sentencePieces(segment.text)) {
      if (closed) sentences.push([]);
      sentences.at(-1)!.push({ text: piece.text });
      closed = piece.ends;
    }
  }
  return sentences;
}

// 串流中只顯示文字：引用標號在回答完成後才出現，還沒收完的「[1」也先不顯示
export const streamingSentences = (text: string): Segment[][] =>
  answerSentences(text.replace(/\[[\d,\s]*$/, "")).map((sentence) => sentence.filter((segment) => "text" in segment));

// 第 i 句的延遲是第幾格（乘上 --motion-stagger-sentence）：串流中已經出現的 streamed 句不再延遲，其餘從 0 起依序排，超過 6 句不再延遲
export const sentenceStep = (i: number, streamed: number): number => staggerIndex(i - streamed);

// 回答提到的實體在最後一句升起之後才出現：最後一句的格數（加上 base 與 settle，見 app.css）
export const answerDoneStep = (count: number, streamed: number): number => sentenceStep(count - 1, streamed);
