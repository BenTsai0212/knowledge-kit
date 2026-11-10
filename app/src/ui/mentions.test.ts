import { describe, expect, it } from "vitest";
import type { Graph, GraphEntity, SourcePassage } from "../graph/read";
import type { Answer } from "../qa/answer";
import { followUps, MAX_FOLLOW_UPS, mentionedEntities, neighborhood } from "./mentions";

// 參考情境的知識模型（client/knowledge-model.json）：person、team、project；member-of、works-on、leads
const passage = (id: string): SourcePassage => ({ id, documentId: "d", documentTitle: "d", language: "zh-TW", content: "" });
const entity = (id: string, type: string, zh: string, en: string, sources: string[]): GraphEntity => ({
  id,
  type,
  name: zh,
  names: { "zh-TW": zh, en },
  sources: sources.map(passage),
});
const relation = (id: string, type: string, from: string, to: string) => ({ id, type, from, to, sources: [] });

const GRAPH: Graph = {
  entities: [
    entity("wang", "person", "王小明", "Ming Wang", ["p1"]),
    entity("lin-rd", "person", "林志明", "Zhiming Lin", ["p2"]),
    entity("lin-sales", "person", "林志明", "Zhiming Lin", ["p3"]),
    entity("rd", "team", "研發部", "R&D", ["p1", "p2"]),
    entity("bluewing", "project", "青翼專案", "Project Bluewing", ["p1"]),
  ],
  relations: [
    relation("r1", "leads", "wang", "bluewing"),
    relation("r2", "member-of", "wang", "rd"),
    relation("r3", "works-on", "rd", "bluewing"),
    relation("r4", "works-on", "lin-rd", "bluewing"),
    relation("r5", "member-of", "lin-rd", "rd"),
    relation("r6", "leads", "wang", "rd"),
  ],
};

const answer = (text: string, cited: string[]): Answer => ({
  kind: "answer",
  text,
  numbering: cited,
  cited,
  dropped: [],
  uncited: cited.length === 0,
  incomplete: false,
});
const ids = (entities: GraphEntity[]) => entities.map((e) => e.id);

describe("mentionedEntities", () => {
  it("引用段落的實體，而且名稱出現在回答中；依出現的位置排序", () => {
    expect(ids(mentionedEntities(GRAPH, answer("青翼專案由研發部的王小明負責 [1]。", ["p1"])))).toEqual(["bluewing", "rd", "wang"]);
  });

  it("名稱出現在回答中、但出處不在引用段落的實體不列（同名的另一位林志明）", () => {
    expect(ids(mentionedEntities(GRAPH, answer("林志明在研發部 [1]。", ["p2"])))).toEqual(["lin-rd", "rd"]);
  });

  it("引用段落的實體、但回答沒寫到名稱的不列", () => {
    expect(ids(mentionedEntities(GRAPH, answer("由他負責 [1]。", ["p1"])))).toEqual([]);
  });

  it("任一語言的顯示名稱都算，不分大小寫", () => {
    expect(ids(mentionedEntities(GRAPH, answer("MING WANG leads project bluewing [1].", ["p1"])))).toEqual(["wang", "bluewing"]);
  });

  it("拒答、錯誤、未附出處的回答不列", () => {
    expect(mentionedEntities(GRAPH, { kind: "refusal", text: "王小明" })).toEqual([]);
    expect(mentionedEntities(GRAPH, { kind: "error", error: "upstream_error" })).toEqual([]);
    expect(mentionedEntities(GRAPH, answer("王小明負責青翼專案。", []))).toEqual([]);
  });

  it("候選只來自傳入的圖譜：圖譜中沒有的實體，即使回答寫了名稱也不列", () => {
    const visible: Graph = { entities: GRAPH.entities.filter((e) => e.id !== "wang"), relations: [] };
    expect(ids(mentionedEntities(visible, answer("王小明負責青翼專案 [1]。", ["p1"])))).toEqual(["bluewing"]);
  });
});

describe("neighborhood", () => {
  it("中心、直接相連的實體與兩者之間的關係", () => {
    const g = neighborhood(GRAPH, "lin-rd");
    expect(ids(g.entities)).toEqual(["lin-rd", "rd", "bluewing"]);
    expect(g.relations.map((r) => r.id)).toEqual(["r4", "r5"]);
  });

  it("沒有關係的實體只有自己", () => {
    expect(neighborhood(GRAPH, "lin-sales")).toEqual({ entities: [GRAPH.entities[2]], relations: [] });
  });
});

describe("followUps", () => {
  it("依方向使用不同的範本（#195 決定 2）", () => {
    expect(followUps(GRAPH, "wang", "zh-TW")).toEqual(["王小明負責哪些專案？", "王小明隸屬哪些部門？", "王小明負責哪些部門？"]);
    expect(followUps(GRAPH, "bluewing", "zh-TW")).toEqual(["哪些人員負責青翼專案？", "哪些部門參與青翼專案？", "哪些人員參與青翼專案？"]);
  });

  it("英文是英文的語序，類型改成小寫", () => {
    expect(followUps(GRAPH, "wang", "en")[0]).toBe("Which project does Ming Wang have a “Leads” relationship with?");
    expect(followUps(GRAPH, "bluewing", "en")[0]).toBe("Which person has a “Leads” relationship with Project Bluewing?");
  });

  it("關係類型、方向與另一端的類型相同的只留一題，最多 MAX_FOLLOW_UPS 題", () => {
    const many: Graph = {
      entities: [...GRAPH.entities, ...["a", "b", "c", "d"].map((x) => entity(x, "person", x, x, []))],
      relations: [...GRAPH.relations, ...["a", "b", "c", "d"].map((x) => relation(`r-${x}`, "member-of", x, "rd"))],
    };
    // rd：← member-of 人員（多位只留一題）、works-on → 專案、← leads 人員
    expect(followUps(many, "rd", "zh-TW")).toEqual(["哪些人員隸屬研發部？", "研發部參與哪些專案？", "哪些人員負責研發部？"]);
    const fan: Graph = {
      entities: GRAPH.entities,
      relations: ["leads", "member-of", "works-on", "other"].flatMap((type, i) => [relation(`x${i}`, type, "wang", "rd")]),
    };
    expect(followUps(fan, "wang", "zh-TW")).toHaveLength(MAX_FOLLOW_UPS);
  });

  it("沒有關係或找不到實體時沒有", () => {
    expect(followUps(GRAPH, "lin-sales", "zh-TW")).toEqual([]);
    expect(followUps(GRAPH, "missing", "zh-TW")).toEqual([]);
  });
});
