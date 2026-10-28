import { describe, expect, it } from "vitest";
import { MAX_HOPS, shortestPath } from "./path";
import type { Graph } from "./read";

const graph = (entities: string[], relations: [id: string, from: string, to: string][]): Graph => ({
  entities: entities.map((id) => ({ id, type: "person", name: id, names: {}, sources: [] })),
  relations: relations.map(([id, from, to]) => ({ id, type: "works-on", from, to, sources: [] })),
});

describe("shortestPath", () => {
  it("回傳經過的實體與關係，不分關係方向", () => {
    const g = graph(["a", "b", "c"], [["r1", "a", "b"], ["r2", "c", "b"]]);
    expect(shortestPath(g, "a", "c")).toEqual([{ entity: "a" }, { entity: "b", relation: "r1" }, { entity: "c", relation: "r2" }]);
    expect(shortestPath(g, "c", "a")).toEqual([{ entity: "c" }, { entity: "b", relation: "r2" }, { entity: "a", relation: "r1" }]);
  });

  it("起點與終點相同時只有一步", () => {
    expect(shortestPath(graph(["a"], []), "a", "a")).toEqual([{ entity: "a" }]);
  });

  it("多條最短路徑時，依關係 id 的順序選擇，結果固定", () => {
    const g = graph(["a", "b", "c", "d"], [["r-z", "a", "b"], ["r-a", "a", "c"], ["r-b", "b", "d"], ["r-c", "c", "d"]]);
    expect(shortestPath(g, "a", "d")).toEqual([{ entity: "a" }, { entity: "c", relation: "r-a" }, { entity: "d", relation: "r-c" }]);
  });

  it("超過 MAX_HOPS 時找不到", () => {
    const ids = Array.from({ length: MAX_HOPS + 2 }, (_, i) => `e${i}`);
    const chain = graph(ids, ids.slice(1).map((id, i) => [`r${i}`, ids[i], id]));
    expect(shortestPath(chain, "e0", `e${MAX_HOPS}`)).toHaveLength(MAX_HOPS + 1);
    expect(shortestPath(chain, "e0", `e${MAX_HOPS + 1}`)).toBeNull();
  });

  it("沒有連通、或起點與終點不在圖中時找不到", () => {
    const g = graph(["a", "b", "c"], [["r1", "a", "b"]]);
    expect(shortestPath(g, "a", "c")).toBeNull();
    expect(shortestPath(g, "a", "x")).toBeNull();
    expect(shortestPath(g, "x", "a")).toBeNull();
  });

  it("端點不在圖中的關係不使用", () => {
    expect(shortestPath(graph(["a", "c"], [["r1", "a", "b"], ["r2", "b", "c"]]), "a", "c")).toBeNull();
  });
});
