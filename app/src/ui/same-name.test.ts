import { describe, expect, it } from "vitest";
import type { Graph, GraphEntity } from "../graph/read";
import { sameNameAsk } from "./same-name";

// 參考情境的知識模型（client/knowledge-model.json）：person、team、project
const entity = (id: string, type: string, zh: string, en: string): GraphEntity => ({ id, type, name: zh, names: { "zh-TW": zh, en }, sources: [] });
const relation = (id: string, type: string, from: string, to: string) => ({ id, type, from, to, sources: [] });

const GRAPH: Graph = {
  entities: [
    entity("lin-rd", "person", "林志明", "Zhiming Lin"),
    entity("lin-sales", "person", "林志明", "Zhiming Lin"),
    entity("rd", "team", "研發部", "R&D"),
    entity("sales", "team", "業務部", "Sales"),
    entity("bluewing", "project", "青翼專案", "Project Bluewing"),
  ],
  relations: [relation("r1", "member-of", "lin-rd", "rd"), relation("r2", "member-of", "lin-sales", "sales")],
};

describe("sameNameAsk（ADR 0012 決定 1）", () => {
  it("提到看得到的兩位同名人員時反問，選項是 entityOptionLabel() 的區分，送出時名稱換成選項", () => {
    expect(sameNameAsk(GRAPH, "林志明負責哪些專案？", "zh-TW")).toEqual({
      name: "林志明",
      options: [
        { entityId: "lin-rd", label: "林志明（研發部）", text: "林志明（研發部）負責哪些專案？" },
        { entityId: "lin-sales", label: "林志明（業務部）", text: "林志明（業務部）負責哪些專案？" },
      ],
    });
  });

  it("英文介面以英文名稱比對（不分大小寫），替換問題中實際出現的寫法", () => {
    const ask = sameNameAsk(GRAPH, "What does zhiming lin work on?", "en");
    expect(ask?.name).toBe("Zhiming Lin");
    expect(ask?.options.map((o) => o.text)).toEqual(["What does Zhiming Lin (R&D) work on?", "What does Zhiming Lin (Sales) work on?"]);
  });

  it("只看得到一位時不反問（看不到的那一位不在圖譜中，#247）", () => {
    const visible: Graph = { entities: GRAPH.entities.filter((e) => e.id !== "lin-sales"), relations: GRAPH.relations.slice(0, 1) };
    expect(sameNameAsk(visible, "林志明負責哪些專案？", "zh-TW")).toBeNull();
  });

  it("類型不同的同名不反問", () => {
    const graph: Graph = { entities: [entity("p", "person", "青翼", "Bluewing"), entity("j", "project", "青翼", "Bluewing")], relations: [] };
    expect(sameNameAsk(graph, "青翼是什麼？", "zh-TW")).toBeNull();
  });

  it("問題已含區分的說明時不反問（例如「接著問」）", () => {
    expect(sameNameAsk(GRAPH, "林志明（業務部）隸屬哪些部門？", "zh-TW")).toBeNull();
  });

  it("問題沒有提到同名的實體時不反問", () => {
    expect(sameNameAsk(GRAPH, "青翼專案什麼時候上市？", "zh-TW")).toBeNull();
  });

  it("entityOptionLabel() 分不出來（沒有相關實體）時不反問", () => {
    const graph: Graph = { entities: [entity("a", "person", "林志明", "Zhiming Lin"), entity("b", "person", "林志明", "Zhiming Lin")], relations: [] };
    // 沒有相關實體時標籤是 id，仍分得出來
    expect(sameNameAsk(graph, "林志明是誰？", "zh-TW")?.options.map((o) => o.label)).toEqual(["林志明（a）", "林志明（b）"]);
    const same: Graph = { ...GRAPH, relations: [relation("r1", "member-of", "lin-rd", "rd"), relation("r2", "member-of", "lin-sales", "rd")] };
    expect(sameNameAsk(same, "林志明是誰？", "zh-TW")).toBeNull();
  });
});
