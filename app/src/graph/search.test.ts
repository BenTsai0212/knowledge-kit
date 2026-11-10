import { describe, expect, it } from "vitest";
import type { Graph } from "./read";
import { excludedEntities, relationCounts, SEARCH_LIMIT, searchEntities, TOP_LIMIT, topConnected } from "./search";

const entity = (id: string, type: string, name: string, names: Record<string, string> = {}) => ({ id, type, name, names, sources: [] });
const relation = (id: string, from: string, to: string) => ({ id, type: "works-on", from, to, sources: [] });

const g: Graph = {
  entities: [
    entity("p1", "person", "王小明", { "zh-TW": "王小明", en: "Ming Wang" }),
    entity("p2", "person", "王大同", { "zh-TW": "王大同", en: "Datong Wang" }),
    entity("t1", "team", "研發部", { "zh-TW": "研發部", en: "R&D" }),
    entity("j1", "project", "Blue Wing", { "zh-TW": "青翼專案", en: "Blue Wing" }),
    entity("x", "unknown", "ＡＢＣ"),
  ],
  relations: [relation("r1", "p1", "t1"), relation("r2", "p2", "t1"), relation("r3", "p1", "j1"), relation("r4", "t1", "j1")],
};

const types = [
  { id: "person", aliasRules: { ignoreCase: true, normalizeWidth: true, ignoreWhitespace: true } },
  { id: "team", aliasRules: { ignoreCase: true, normalizeWidth: true, ignoreWhitespace: true } },
  // 專案不忽略空白
  { id: "project", aliasRules: { ignoreCase: true, normalizeWidth: true, ignoreWhitespace: false } },
];
const ids = (list: { id: string }[]) => list.map((e) => e.id);

describe("搜尋（#199）", () => {
  it("比對各語言的顯示名稱與主要名稱，部分符合也算", () => {
    expect(ids(searchEntities(g, "王", "zh-TW", types))).toEqual(["p2", "p1"]);
    expect(ids(searchEntities(g, "wang", "zh-TW", types))).toEqual(["p2", "p1"]);
    expect(ids(searchEntities(g, "青翼", "en", types))).toEqual(["j1"]);
  });

  it("以類型的 aliasRules 正規化：大小寫、全半形；專案不忽略空白", () => {
    expect(ids(searchEntities(g, "ＭＩＮＧ", "en", types))).toEqual(["p1"]);
    expect(ids(searchEntities(g, "mingwang", "en", types))).toEqual(["p1"]);
    expect(ids(searchEntities(g, "bluewing", "en", types))).toEqual([]);
    expect(ids(searchEntities(g, "blue wing", "en", types))).toEqual(["j1"]);
    // 找不到類型時一律寬鬆比對
    expect(ids(searchEntities(g, "abc", "en", types))).toEqual(["x"]);
  });

  it("名稱以查詢開頭的排前面", () => {
    expect(ids(searchEntities(g, "w", "en", types))).toEqual(["j1", "p2", "p1"]);
    expect(ids(searchEntities(g, "d", "en", types))).toEqual(["p2", "t1"]);
  });

  it("空白的查詢沒有結果；最多 SEARCH_LIMIT 筆", () => {
    expect(searchEntities(g, "  ", "en", types)).toEqual([]);
    const many: Graph = { entities: Array.from({ length: 20 }, (_, i) => entity(`e${i}`, "person", `name ${i}`)), relations: [] };
    expect(searchEntities(many, "name", "en", types)).toHaveLength(SEARCH_LIMIT);
  });

  it("類型篩選：沒勾的類型不在結果中", () => {
    expect(ids(searchEntities(g, "w", "en", types, new Set(["person"])))).toEqual(["p2", "p1"]);
    expect(excludedEntities(g, new Set(["person"]))).toEqual(new Set(["t1", "j1", "x"]));
    expect(excludedEntities(g, null)).toEqual(new Set());
  });
});

describe("關聯最多（#199）", () => {
  it("依關聯數由多到少，同數依顯示名稱；沒有關聯的不列", () => {
    expect(relationCounts(g)).toEqual(new Map([["p1", 2], ["t1", 3], ["p2", 1], ["j1", 2]]));
    expect(topConnected(g, "en").map((x) => [x.entity.id, x.count])).toEqual([
      ["t1", 3],
      ["j1", 2],
      ["p1", 2],
      ["p2", 1],
    ]);
  });

  it("類型篩選後再取；最多 TOP_LIMIT 個", () => {
    expect(ids(topConnected(g, "en", new Set(["person"])).map((x) => x.entity))).toEqual(["p1", "p2"]);
    const star: Graph = {
      entities: Array.from({ length: 10 }, (_, i) => entity(`e${i}`, "person", `e${i}`)),
      relations: Array.from({ length: 9 }, (_, i) => relation(`r${i}`, "e0", `e${i + 1}`)),
    };
    expect(topConnected(star, "en")).toHaveLength(TOP_LIMIT);
  });
});
