import { describe, expect, it } from "vitest";
import type { GraphEntity } from "../graph/read";
import { sourceGraphTarget, sourceSteps } from "./source-steps";

describe("sourceSteps()：出處 N／M 與上一個、下一個（#256）", () => {
  const numbering = ["p1", "p2", "p1", "p3"];

  it("同一段被引用多次只算一次，依第一次出現的順序", () => {
    expect(sourceSteps(numbering, "p1")).toEqual({ index: 1, total: 3, prev: null, next: "p2" });
    expect(sourceSteps(numbering, "p2")).toEqual({ index: 2, total: 3, prev: "p1", next: "p3" });
  });

  it("最後一個沒有下一個（不循環）", () => {
    expect(sourceSteps(numbering, "p3")).toEqual({ index: 3, total: 3, prev: "p2", next: null });
  });

  it("只有一個出處：上一個、下一個都沒有", () => {
    expect(sourceSteps(["p1"], "p1")).toEqual({ index: 1, total: 1, prev: null, next: null });
  });

  it("段落不是這一題的出處（例如從段落旁的標示打開）：null", () => {
    expect(sourceSteps(numbering, "p9")).toBeNull();
    expect(sourceSteps([], "p1")).toBeNull();
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
