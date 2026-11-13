import { describe, expect, it } from "vitest";
import type { GraphEntity } from "../graph/read";
import { resolveCitations } from "../qa/citations";
import { sourceGraphTarget, sourceSteps } from "./source-steps";

describe("sourceSteps()：出處 N／M 與上一個、下一個（#256）", () => {
  const cited = ["p1", "p2", "p1", "p3"];

  it("同一段被引用多次只算一次，依第一次出現的順序", () => {
    expect(sourceSteps(cited, "p1")).toEqual({ index: 1, total: 3, prev: null, next: "p2" });
    expect(sourceSteps(cited, "p2")).toEqual({ index: 2, total: 3, prev: "p1", next: "p3" });
  });

  it("最後一個沒有下一個（不循環）", () => {
    expect(sourceSteps(cited, "p3")).toEqual({ index: 3, total: 3, prev: "p2", next: null });
  });

  it("只有一個出處：上一個、下一個都沒有", () => {
    expect(sourceSteps(["p1"], "p1")).toEqual({ index: 1, total: 1, prev: null, next: null });
  });

  it("段落不是這一題的出處（例如從段落旁的標示打開）：null", () => {
    expect(sourceSteps(cited, "p9")).toBeNull();
    expect(sourceSteps([], "p1")).toBeNull();
  });
});

describe("sourceSteps()：M 只算回答引用到的段落（cited），不是檢索到的全部段落（#256 補充決定）", () => {
  // 送進 prompt 的段落：[1] p1、[2] p2、[3] p3
  const retrieved = ["p1", "p2", "p3"];
  const cited = (text: string) => resolveCitations(text, retrieved).cited;

  it("檢索到 3 段、回答只引用 [1]：出處 1／1，上一個、下一個都停用", () => {
    expect(sourceSteps(cited("答案 [1]。"), "p1")).toEqual({ index: 1, total: 1, prev: null, next: null });
  });

  it("檢索到但沒有引用的段落不是這一題的出處：null（只顯示「原文」）", () => {
    expect(sourceSteps(cited("答案 [1]。"), "p2")).toBeNull();
    expect(sourceSteps(cited("答案 [1]。"), "p3")).toBeNull();
  });

  it("回答引用 [3][1]：依第一次引用的順序，跳過沒有引用的 [2]", () => {
    const c = cited("甲 [3]。乙 [1][3]。");
    expect(sourceSteps(c, "p3")).toEqual({ index: 1, total: 2, prev: null, next: "p1" });
    expect(sourceSteps(c, "p1")).toEqual({ index: 2, total: 2, prev: "p3", next: null });
    expect(sourceSteps(c, "p2")).toBeNull();
  });
});

describe("sourceGraphTarget()：「在圖譜中查看」的目標（#256 決定 2）", () => {
  const entity = (id: string, sources: string[]): GraphEntity => ({
    id,
    type: "person",
    name: id,
    names: {},
    sources: sources.map((p) => ({ id: p, documentId: "d", documentTitle: "d", language: "zh-TW", content: "" })),
  });
  const document = ["p1", "p2", "p3"];

  it("出處包含目前引用段落的優先，依回答提到的順序", () => {
    const entities = [entity("a", ["p1"]), entity("b", ["p2"]), entity("c", ["p2"])];
    expect(sourceGraphTarget(entities, "p2", document)).toBe("b");
  });

  it("沒有時是文件中最先提到的（依段落順序，不依回答提到的順序）", () => {
    const entities = [entity("late", ["p3"]), entity("early", ["p1"])];
    expect(sourceGraphTarget(entities, "p2", document)).toBe("early");
  });

  it("都沒有時 null（不顯示按鈕）", () => {
    expect(sourceGraphTarget([entity("x", ["q1"])], "p2", document)).toBeNull();
    expect(sourceGraphTarget([], "p2", document)).toBeNull();
  });
});
