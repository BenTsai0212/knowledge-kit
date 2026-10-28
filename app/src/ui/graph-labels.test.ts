import { describe, expect, it } from "vitest";
import type { Graph } from "../graph/read";
import { entityName, entityTypeLabel, relatedEntities, relationTypeLabel } from "./graph-labels";

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
});
