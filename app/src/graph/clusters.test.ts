// 大量節點時的圖譜（#254）：門檻、篩選、分群、聚合線與泡泡的數值。大型資料的測試在 app/tests/graph/large-graph.test.ts
import { describe, expect, it } from "vitest";
import {
  aggregateEdges,
  aggregateWidth,
  bubbleDiameter,
  clusterGraph,
  filterGraph,
  isAggregated,
  labelledInCluster,
  NO_FILTERS,
  OTHER_CLUSTER,
  scaleMode,
  type ClusterModel,
} from "./clusters";
import type { Graph } from "./read";

const node = (id: string, type: string) => ({ id, type, name: id, names: {}, sources: [] });
const rel = (id: string, from: string, to: string) => ({ id, type: "r", from, to, sources: [] });

const MODEL: ClusterModel = { entityTypes: [{ id: "person" }, { id: "team", container: true }, { id: "project", container: true }] };

// t1、t2 兩個部門、p1 一個專案；a、b 屬於 t1，c 屬於 t2，d 同時屬於 t1 與 p1（部門的順序在前），e 沒有關係
const graph: Graph = {
  entities: [node("t1", "team"), node("t2", "team"), node("p1", "project"), node("a", "person"), node("b", "person"), node("c", "person"), node("d", "person"), node("e", "person")],
  relations: [rel("r1", "a", "t1"), rel("r2", "b", "t1"), rel("r3", "c", "t2"), rel("r4", "d", "t1"), rel("r5", "d", "p1"), rel("r6", "a", "c"), rel("r7", "b", "c"), rel("r8", "t1", "p1")],
};

describe("門檻", () => {
  it("桌機超過 60、手機超過 30 時從全覽開始", () => {
    expect(scaleMode(60, false)).toBe("all");
    expect(scaleMode(61, false)).toBe("overview");
    expect(scaleMode(30, true)).toBe("all");
    expect(scaleMode(31, true)).toBe("overview");
  });

  it("類型篩選與「只顯示關聯 ≥ N」後的圖只留兩端都還在的關係", () => {
    const people = filterGraph(graph, { types: new Set(["person"]), minRelations: 0 });
    expect(people.entities.map((e) => e.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(people.relations.map((r) => r.id)).toEqual(["r6", "r7"]);
    const busy = filterGraph(graph, { types: null, minRelations: 2 });
    expect(busy.entities.map((e) => e.id)).toEqual(["t1", "p1", "a", "b", "c", "d"]);
    expect(filterGraph(graph, NO_FILTERS)).toEqual(graph);
  });
});

describe("容器分群", () => {
  const { clusters, clusterOf } = clusterGraph(graph, MODEL);

  it("每個容器自成一群，其他實體歸入相連的容器；屬於多群時依類型順序；連不到容器的放進「其他」", () => {
    expect(Object.fromEntries(clusterOf)).toEqual({ t1: "t1", a: "t1", b: "t1", d: "t1", t2: "t2", c: "t2", p1: "p1", e: OTHER_CLUSTER });
    expect(clusters.map((c) => c.id)).toEqual(["t1", "t2", "p1", OTHER_CLUSTER]);
    expect(clusters.at(-1)).toMatchObject({ kind: "other", anchor: null });
  });

  it("類型組成依實體數，最多 3 個", () => {
    expect(clusters[0]!.composition).toEqual([
      { type: "person", count: 3 },
      { type: "team", count: 1 },
    ]);
  });

  it("同一個容器類型中，關係數多的容器優先", () => {
    const g: Graph = { entities: [node("t1", "team"), node("t2", "team"), node("a", "person")], relations: [rel("x", "a", "t1"), rel("y", "a", "t2"), rel("z", "t2", "a")] };
    expect(clusterGraph(g, MODEL).clusterOf.get("a")).toBe("t2");
  });

  it("看得到的實體中沒有容器時改用社群偵測", () => {
    const people = filterGraph(graph, { types: new Set(["person"]), minRelations: 0 });
    expect(clusterGraph(people, MODEL).clusters.map((c) => c.kind)).toEqual(["community", "other"]);
  });
});

describe("社群偵測", () => {
  // 兩個三角形以一條線相連，再加一個孤立的實體
  const g: Graph = {
    entities: ["a", "b", "c", "x", "y", "z", "lone"].map((id) => node(id, "person")),
    relations: [rel("1", "a", "b"), rel("2", "b", "c"), rel("3", "c", "a"), rel("4", "x", "y"), rel("5", "y", "z"), rel("6", "z", "x"), rel("7", "c", "x"), rel("8", "a", "c")],
  };

  it("分成兩群，群組名稱是群內關聯最多的實體，沒有關係的放進「其他」", () => {
    const { clusters } = clusterGraph(g, { entityTypes: [{ id: "person" }] });
    expect(clusters.map((c) => [c.id, c.members])).toEqual([
      ["community:c", ["a", "b", "c"]],
      ["community:x", ["x", "y", "z"]],
      [OTHER_CLUSTER, ["lone"]],
    ]);
  });

  it("反轉輸入順序結果相同", () => {
    const reversed = { entities: [...g.entities].reverse(), relations: [...g.relations].reverse() };
    expect(clusterGraph(reversed, { entityTypes: [] })).toEqual(clusterGraph(g, { entityTypes: [] }));
  });
});

describe("聚合線", () => {
  it("兩群之間的關係不分方向合併並計算段數，同群的不算", () => {
    const clustering = clusterGraph(graph, MODEL);
    const edges = aggregateEdges(graph, clustering);
    expect(edges).toEqual([
      { from: "p1", to: "t1", relations: ["r5", "r8"] },
      { from: "t1", to: "t2", relations: ["r6", "r7"] },
    ]);
    expect(edges.every(isAggregated)).toBe(true);
    expect(isAggregated({ from: "a", to: "b", relations: ["r"] })).toBe(false);
  });

  it("泡泡直徑 44 + 12√n、聚合線寬 1 + 0.45 × 段數", () => {
    expect(bubbleDiameter(1)).toBe(56);
    expect(bubbleDiameter(25)).toBe(104);
    expect(aggregateWidth(2)).toBeCloseTo(1.9);
    expect(aggregateWidth(10)).toBeCloseTo(5.5);
  });
});

describe("第 2 層的標籤", () => {
  it("群內關聯數前 10%（至少 1 個）加上選取的節點", () => {
    const t1 = clusterGraph(graph, MODEL).clusters[0]!;
    expect([...labelledInCluster(graph, t1)]).toEqual(["t1"]);
    expect([...labelledInCluster(graph, t1, "b")]).toEqual(["t1", "b"]);
    expect([...labelledInCluster(graph, t1, "c")]).toEqual(["t1"]);
  });
});
