import { describe, expect, it } from "vitest";
import { ALL, expand, focusOf, keepVisible, nearRelations, only, selectedOf } from "./expansion";
import type { Graph } from "./read";

const graph = (entities: string[], relations: [id: string, from: string, to: string][]): Graph => ({
  entities: entities.map((id) => ({ id, type: "person", name: id, names: {}, sources: [] })),
  relations: relations.map(([id, from, to]) => ({ id, type: "works-on", from, to, sources: [] })),
});

// a — b — c — d，b — e，另有不相連的 x — y
const g = graph(
  ["a", "b", "c", "d", "e", "x", "y"],
  [
    ["ab", "a", "b"],
    ["cb", "c", "b"],
    ["cd", "c", "d"],
    ["be", "b", "e"],
    ["ce", "c", "e"],
    ["xy", "x", "y"],
  ],
);
const sorted = (set: ReadonlySet<string> | undefined) => [...(set ?? [])].sort();

describe("逐步展開（#199）", () => {
  it("全部：沒有選取，也沒有聚焦集合", () => {
    expect(selectedOf(ALL)).toBeNull();
    expect(focusOf(g, ALL)).toBeNull();
  });

  it("聚焦集合是路徑上的節點與直接鄰居（不分方向），以及這些節點之間的關係", () => {
    const focus = focusOf(g, ["a"]);
    expect(sorted(focus?.entities)).toEqual(["a", "b"]);
    expect(sorted(focus?.relations)).toEqual(["ab"]);
    const next = focusOf(g, ["a", "b"]);
    expect(sorted(next?.entities)).toEqual(["a", "b", "c", "e"]);
    // c — e 兩端都在聚焦集合中，一併顯示
    expect(sorted(next?.relations)).toEqual(["ab", "be", "cb", "ce"]);
  });

  it("點聚焦集合中的節點：接在路徑後面，已展開的路徑累積；選取的是最後一個", () => {
    const first = expand(g, ALL, "a");
    expect(first).toEqual(["a"]);
    const second = expand(g, first, "b");
    expect(second).toEqual(["a", "b"]);
    const third = expand(g, second, "c");
    expect(third).toEqual(["a", "b", "c"]);
    expect(selectedOf(third)).toBe("c");
    expect(sorted(focusOf(g, third)?.entities)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("點已在路徑上的節點：截到該處", () => {
    expect(expand(g, ["a", "b", "c"], "b")).toEqual(["a", "b"]);
    expect(expand(g, ["a", "b", "c"], "c")).toEqual(["a", "b", "c"]);
  });

  it("點變灰的節點：等同只看它", () => {
    expect(expand(g, ["a"], "d")).toEqual(only("d"));
    expect(expand(g, ["a", "b"], "x")).toEqual(["x"]);
  });

  it("切換身分後：路徑截到第一個看不到的實體之前", () => {
    const smaller = graph(["a", "c"], []);
    expect(keepVisible(smaller, ["a", "b", "c"])).toEqual(["a"]);
    expect(keepVisible(smaller, ["b", "c"])).toEqual([]);
    expect(keepVisible(g, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("關係名稱只在選取節點的相連關係顯示；沒有選取時都不顯示", () => {
    expect(sorted(nearRelations(g, "c"))).toEqual(["cb", "cd", "ce"]);
    expect(sorted(nearRelations(g, null))).toEqual([]);
  });
});
