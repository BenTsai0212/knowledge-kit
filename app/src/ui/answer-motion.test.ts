import { describe, expect, it } from "vitest";
import { answerDoneStep, answerSentences, sentenceStep, streamingSentences } from "./answer-motion";

describe("問答的逐句動態（#227）", () => {
  it("切成句子，引用標號歸到它前面的句子；接起來等於原文", () => {
    const text = "第一句。[1]第二句[2][3]。Third one [1]. Fourth";
    const sentences = answerSentences(text);
    expect(sentences).toEqual([
      [{ text: "第一句。" }, { citation: 1 }],
      [{ text: "第二句" }, { citation: 2 }, { citation: 3 }, { text: "。" }],
      [{ text: "Third one " }, { citation: 1 }, { text: ". " }],
      [{ text: "Fourth" }],
    ]);
    const joined = sentences
      .flat()
      .map((s) => ("text" in s ? s.text : `[${s.citation}]`))
      .join("");
    expect(joined).toBe(text);
  });

  it("串流中不顯示引用標號，也不顯示還沒收完的標號", () => {
    expect(streamingSentences("第一句。[1]第二句[1")).toEqual([[{ text: "第一句。" }], [{ text: "第二句" }]]);
    expect(streamingSentences("")).toEqual([]);
  });

  it("串流中出現過的句子不再延遲；其餘依序排，超過 6 句不再延遲", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => sentenceStep(i, 0))).toEqual([0, 1, 2, 3, 4, 5, 5, 5]);
    expect([0, 1, 2, 3, 4].map((i) => sentenceStep(i, 3))).toEqual([0, 0, 0, 0, 1]);
    expect(answerDoneStep(3, 0)).toBe(2);
    expect(answerDoneStep(3, 3)).toBe(0);
    expect(answerDoneStep(20, 0)).toBe(5);
  });
});
