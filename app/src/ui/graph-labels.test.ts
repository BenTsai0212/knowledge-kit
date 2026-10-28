import { describe, expect, it } from "vitest";
import type { Graph, SourcePassage } from "../graph/read";
import { entityName, entityOptionLabel, entityTypeLabel, relatedEntities, relationTypeLabel, sourcesForLanguage } from "./graph-labels";

const entity = (id: string, names: Record<string, string>) => ({ id, type: "person", name: `${id}-name`, names, sources: [] });
const graph: Graph = {
  entities: [entity("a", { "zh-TW": "甲", en: "A" }), entity("b", { "zh-TW": "乙", en: "B" }), entity("c", { "zh-TW": "丙" })],
  relations: [
    { id: "r1", type: "member-of", from: "a", to: "b", sources: [] },
    { id: "r2", type: "leads", from: "c", to: "a", sources: [] },
    // 另一端不在圖中的關係不列出
    { id: "r3", type: "leads", from: "a", to: "x", sources: [] },
  ],
};

describe("圖譜的顯示文字", () => {
  it("實體名稱依介面語言，缺少時退回主要名稱", () => {
    expect(entityName(graph.entities[0], "en")).toBe("A");
    expect(entityName(graph.entities[2], "en")).toBe("c-name");
  });

  it("類型名稱來自 knowledge-model.json，不認得的類型顯示 id", () => {
    expect(entityTypeLabel("person", "en")).toBe("Person");
    expect(relationTypeLabel("member-of", "zh-TW")).toBe("隸屬");
    expect(entityTypeLabel("vendor", "en")).toBe("vendor");
  });

  it("相關實體帶出關係名稱與方向", () => {
    expect(relatedEntities(graph, "a", "en").map((r) => [r.relationId, r.label, r.outgoing, r.entity.id])).toEqual([
      ["r1", "Member of", true, "b"],
      ["r2", "Leads", false, "c"],
    ]);
  });

  it("下拉選單中，顯示名稱相同的實體加上第一個相關實體的名稱", () => {
    const twins: Graph = {
      entities: [entity("lin-1", { en: "Lin" }), entity("lin-2", { en: "Lin" }), entity("rd", { en: "R&D" }), entity("solo", { en: "Solo" })],
      relations: [{ id: "r1", type: "member-of", from: "lin-1", to: "rd", sources: [] }],
    };
    expect(twins.entities.map((e) => entityOptionLabel(twins, e, "en"))).toEqual(["Lin（R&D）", "Lin（lin-2）", "R&D", "Solo"]);
  });
});

describe("sourcesForLanguage", () => {
  const source = (id: string, language: string): SourcePassage => ({ id, documentId: `${id}-doc`, documentTitle: id, language, content: id });
  const zh = [source("zh-1", "zh-TW"), source("zh-2", "zh-TW")];
  const en = [source("en-1", "en")];

  it("只有介面語言的出處：全部顯示，不標示語言", () => {
    expect(sourcesForLanguage(en, "en")).toEqual(en);
  });

  it("只有其他語言的出處：全部顯示，並以介面語言標示該段的語言", () => {
    expect(sourcesForLanguage(zh, "en")).toEqual(zh.map((s) => ({ ...s, languageLabel: "Chinese (Taiwan)" })));
    expect(sourcesForLanguage(en, "zh-TW")).toEqual(en.map((s) => ({ ...s, languageLabel: "英文" })));
  });

  it("兩者都有：只顯示介面語言的出處", () => {
    expect(sourcesForLanguage([...zh, ...en], "en")).toEqual(en);
    expect(sourcesForLanguage([...en, ...zh], "zh-TW")).toEqual(zh);
  });

  it("沒有出處：空陣列", () => {
    expect(sourcesForLanguage([], "en")).toEqual([]);
  });
});
