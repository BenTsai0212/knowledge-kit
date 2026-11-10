import { describe, expect, it } from "vitest";
import type { Answer } from "../qa/answer";
import type { GraphEntity } from "../graph/read";
import type { AnswerState } from "./AnswerView";
import { canReport, defaultCategory, reportOf } from "./report-helpers";

const entity = (id: string): GraphEntity => ({ id, type: "person", name: id, names: {}, sources: [] });
const answered = (answer: Answer, entities: GraphEntity[] = []): AnswerState => ({
  question: "誰負責青翼專案？",
  streaming: "",
  answer,
  mentions: { graph: { entities, relations: [] }, entities },
});
const answer: Answer = {
  kind: "answer",
  text: "王小明負責 [2]。",
  numbering: ["p-1", "p-2", "p-3"],
  cited: ["p-2"],
  dropped: [],
  uncited: false,
  incomplete: false,
};

describe("回報有錯", () => {
  it("只有回答與拒答能回報；串流中與錯誤不能", () => {
    expect(canReport(answered(answer))).toBe(true);
    expect(canReport(answered({ kind: "refusal", text: "找不到" }))).toBe(true);
    expect(canReport(answered({ kind: "error", error: "network" }))).toBe(false);
    expect(canReport({ question: "q", streaming: "王" })).toBe(false);
  });

  it("預設的原因：拒答是 should_answer，回答是 wrong_fact", () => {
    expect(defaultCategory(answered({ kind: "refusal", text: "找不到" }))).toBe("should_answer");
    expect(defaultCategory(answered(answer))).toBe("wrong_fact");
  });

  it("回答記錄送出的所有段落（不只引用的）、引用的段落與回答提到的實體", () => {
    expect(reportOf(answered(answer, [entity("e-1"), entity("e-2")]), "wrong_citation", "第 2 段沒有寫")).toEqual({
      category: "wrong_citation",
      note: "第 2 段沒有寫",
      question: "誰負責青翼專案？",
      answer: { text: "王小明負責 [2]。", sent: ["p-1", "p-2", "p-3"], cited: ["p-2"], entities: ["e-1", "e-2"] },
    });
  });

  it("沒有讀出回答提到的實體時（例如未附出處）實體是空的", () => {
    const state: AnswerState = { question: "q", streaming: "", answer: { ...answer, cited: [], uncited: true } };
    expect(reportOf(state, "wrong_fact", "")?.answer).toEqual({ text: answer.text, sent: answer.numbering, cited: [], entities: [] });
  });

  it("拒答的回報只含問題文字；錯誤不能回報", () => {
    expect(reportOf(answered({ kind: "refusal", text: "找不到" }), "should_answer", "")).toEqual({
      category: "should_answer",
      note: "",
      question: "誰負責青翼專案？",
      answer: null,
    });
    expect(reportOf(answered({ kind: "error", error: "network" }), "other", "")).toBeNull();
  });
});
