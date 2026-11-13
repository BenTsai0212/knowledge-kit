// 三層語意縮放（#254）：層級、細節層的範圍、畫在圖上的元素、其他群組的位置與麵包屑
import { describe, expect, it } from "vitest";
import { clusterGraph, type ClusterModel } from "../graph/clusters";
import type { Graph } from "../graph/read";
import { clientConfig } from "../client/load";
import { strings } from "../client/i18n";
import { graphStyle } from "./graph-style";
import { breadcrumb, bubbleId, CALM_LIMIT, detailOf, openEntities, ringPositions, SECOND_OPACITY, SIDE_BUBBLE, SIDE_BUBBLE_OPACITY, MAX_VIEW_ZOOM, VIEW_PADDING, panToCenter, viewOf, viewportFor, zoomLevel } from "./graph-zoom";
import graphPage from "./GraphPage.tsx?raw";
import zoomView from "./GraphZoomView.tsx?raw";

const node = (id: string, type: string) => ({ id, type, name: id, names: {}, sources: [] });
const rel = (id: string, from: string, to: string) => ({ id, type: "r", from, to, sources: [] });
const MODEL: ClusterModel = { entityTypes: [{ id: "person" }, { id: "team", container: true }] };

// t1：a、b、c、d（a—b—c—d 一串）；t2：x、y；a、b 各連到 x（兩群之間 2 段），d 連到 y（1 段）
const graph: Graph = {
  entities: [node("t1", "team"), node("t2", "team"), ...["a", "b", "c", "d", "x", "y"].map((id) => node(id, "person"))],
  relations: [
    rel("ta", "a", "t1"),
    rel("tb", "b", "t1"),
    rel("tc", "c", "t1"),
    rel("td", "d", "t1"),
    rel("tx", "x", "t2"),
    rel("ty", "y", "t2"),
    rel("ab", "a", "b"),
    rel("bc", "b", "c"),
    rel("cd", "c", "d"),
    rel("ax", "a", "x"),
    rel("bx", "b", "x"),
    rel("dy", "d", "y"),
  ],
};
const clustering = clusterGraph(graph, MODEL);
const t1 = clustering.clusters.find((c) => c.id === "t1")!;

describe("層級", () => {
  it("選取的實體在分群中時是細節層，有展開的群組時是群組層，都沒有時是全覽", () => {
    expect(zoomLevel(clustering, null, null)).toEqual({ level: "overview", cluster: null });
    expect(zoomLevel(clustering, "t1", null)).toEqual({ level: "cluster", cluster: "t1" });
    expect(zoomLevel(clustering, "t1", "x")).toEqual({ level: "detail", cluster: "t2" });
    // 篩選或切換身分後已不存在的群組與實體
    expect(zoomLevel(clustering, "gone", "gone")).toEqual({ level: "overview", cluster: null });
  });

  it("麵包屑依層級列出「全部 › 群組 › 實體」", () => {
    expect(breadcrumb("overview", null, null).map((c) => c.kind)).toEqual(["all"]);
    expect(breadcrumb("cluster", "t1", null)).toEqual([
      { kind: "all", id: null },
      { kind: "cluster", id: "t1" },
    ]);
    expect(breadcrumb("detail", "t1", "a").map((c) => c.id)).toEqual([null, "t1", "a"]);
  });
});

describe("細節層", () => {
  it("直接關係、二度關聯（不經過容器）與收合的成員", () => {
    const d = detailOf(graph, t1, "a");
    expect([...d.direct].sort()).toEqual(["ab", "ax", "ta"]);
    expect([...d.near].sort()).toEqual(["b", "t1", "x"]);
    // 不經過部門 t1 往外找：c 經過 b、t2 經過 x
    expect([...d.secondEntities].sort()).toEqual(["c", "t2"]);
    expect(d.second.has("bc") && d.second.has("tx") && !d.second.has("cd") && !d.second.has("td")).toBe(true);
    expect(d.collapsed).toEqual(["d"]);
    expect(detailOf(graph, t1, "d").collapsed).toEqual(["a"]);
  });

  it("畫出的實體：群組層是群內全部；細節層是兩跳以內，「展開」後加上群內全部", () => {
    expect(openEntities("overview", t1, null, null, false).size).toBe(0);
    expect([...openEntities("cluster", t1, null, null, false)].sort()).toEqual(["a", "b", "c", "d", "t1"]);
    const d = detailOf(graph, t1, "d");
    expect(openEntities("detail", t1, "d", d, false).has("a")).toBe(false);
    expect(openEntities("detail", t1, "d", d, true).has("a")).toBe(true);
  });
});

describe("畫在圖上的元素", () => {
  it("全覽：每群一個泡泡，兩群之間 2 段以上合併成聚合線", () => {
    const view = viewOf(graph, clustering, new Set());
    expect(view.entities).toEqual([]);
    expect(view.bubbles.sort()).toEqual(["t1", "t2"]);
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0]!.relations).toEqual(["ax", "bx", "dy"]);
    expect(view.edges[0]!.id).toMatch(/^aggregate:/);
  });

  it("群組層：群內的實體照常畫，其他群組是泡泡；1 段的線保留關係的方向", () => {
    const view = viewOf(graph, clustering, new Set(t1.members));
    expect(view.bubbles).toEqual(["t2"]);
    const toT2 = view.edges.filter((e) => e.target === bubbleId("t2"));
    expect(toT2.map((e) => e.id).sort()).toEqual(["relation:ax", "relation:bx", "relation:dy"]);
    expect(view.edges.find((e) => e.id === "relation:ab")).toMatchObject({ source: "a", target: "b" });
  });

  it("收合的成員不畫，也不併入泡泡；群內全部畫出的群組沒有泡泡", () => {
    const view = viewOf(graph, clustering, new Set(["d", "c", "t1", "y"]), new Set(["a", "b"]));
    expect(view.entities.sort()).toEqual(["c", "d", "t1", "y"]);
    expect(view.bubbles).toEqual(["t2"]);
    expect(view.edges.some((e) => e.relations.some((r) => ["ab", "ax", "bx", "ta", "tb"].includes(r)))).toBe(false);
  });

  it("其他群組平均分布在已排好的節點外圍", () => {
    const ring = ringPositions({ x1: -100, y1: -50, x2: 100, y2: 50 }, 4);
    expect(ring).toHaveLength(4);
    for (const p of ring) expect(Math.hypot(p.x, p.y)).toBeCloseTo(100 + SIDE_BUBBLE);
    expect(ring[0]!.y).toBeCloseTo(-(100 + SIDE_BUBBLE));
  });
});

describe("換層級時的視角", () => {
  const canvas = { width: 800, height: 600 };
  const rendered = (v: { zoom: number; pan: { x: number; y: number } }, x: number, y: number) => ({ x: x * v.zoom + v.pan.x, y: y * v.zoom + v.pan.y });

  it("外框整個放進畫布並置中，四邊至少留白 VIEW_PADDING", () => {
    const box = { x1: -500, y1: 100, x2: 1500, y2: 400 };
    const v = viewportFor(box, canvas);
    const [a, b] = [rendered(v, box.x1, box.y1), rendered(v, box.x2, box.y2)];
    expect(a.x).toBeGreaterThanOrEqual(VIEW_PADDING - 1e-9);
    expect(a.y).toBeGreaterThanOrEqual(VIEW_PADDING - 1e-9);
    expect(b.x).toBeLessThanOrEqual(canvas.width - VIEW_PADDING + 1e-9);
    expect(b.y).toBeLessThanOrEqual(canvas.height - VIEW_PADDING + 1e-9);
    expect(rendered(v, 500, 250)).toEqual({ x: 400, y: 300 });
  });

  it("外框很小（只有一個節點、或節點還疊在同一點）時縮放不超過上限", () => {
    expect(viewportFor({ x1: 10, y1: 10, x2: 10, y2: 10 }, canvas).zoom).toBe(MAX_VIEW_ZOOM);
    expect(viewportFor({ x1: 0, y1: 0, x2: 60, y2: 60 }, canvas).zoom).toBe(MAX_VIEW_ZOOM);
    expect(MAX_VIEW_ZOOM).toBeLessThanOrEqual(2);
  });

  it("panToCenter：平移後節點落在 area 的中央（縮放不變）", () => {
    const v = { zoom: 1.5, pan: panToCenter({ x: 40, y: -30 }, 1.5, { width: 390, height: 251 }) };
    expect(rendered(v, 40, -30)).toEqual({ x: 195, y: 125.5 });
  });

  it("元件以最終位置與全部元素（含外圍的群組泡泡）計算目標視角，不以 fit 對還在泡泡位置的節點", () => {
    const show = zoomView.slice(zoomView.indexOf("const show ="), zoomView.indexOf("const shown ="));
    expect(show.indexOf("viewportFor(instance.elements().boundingBox()")).toBeGreaterThan(-1);
    expect(show.indexOf("viewportFor(")).toBeLessThan(show.indexOf("n.position(origin)"));
    expect(show).not.toContain("fit");
  });
});

describe("樣式與效能設定", () => {
  type Rules = { selector: string; style: Record<string, unknown> }[];
  const rules = graphStyle(() => "", clientConfig.knowledgeModel.entityTypes) as Rules;
  const rule = (selector: string) => rules.find((r) => r.selector === selector)?.style;

  it("泡泡是類型色邊框與 12% 淡底；其他群組 60px、75%；二度關聯 45%、虛線；直接關係 primary 加粗並標名稱", () => {
    expect(rule("node.bubble")).toMatchObject({ "border-width": 2, "background-opacity": 0.12, label: "data(label)" });
    expect(SIDE_BUBBLE).toBe(60);
    expect(rule("node.side")).toMatchObject({ opacity: SIDE_BUBBLE_OPACITY });
    expect(SIDE_BUBBLE_OPACITY).toBe(0.75);
    expect(rule(".second")).toMatchObject({ opacity: SECOND_OPACITY });
    expect(SECOND_OPACITY).toBe(0.45);
    expect(rule("edge.second")).toMatchObject({ "line-style": "dashed" });
    expect(rule("edge.direct")).toMatchObject({ label: "data(label)", width: 4 });
    expect(rule("edge.aggregate")).toMatchObject({ label: "data(label)" });
  });

  it("可見節點超過 150 個時關閉展開的動態與 transition，拖曳、縮放時不畫標籤", () => {
    expect(CALM_LIMIT).toBe(150);
    expect(zoomView).toContain("const calm = graph.entities.length > CALM_LIMIT");
    expect(zoomView).toContain("const still = reduced.current || calm");
    expect(zoomView).toContain("hideLabelsOnViewport: calm");
  });

  it("門檻以下用現行的 GraphView；新的文字都在 client/i18n/", () => {
    expect(graphPage).toContain("scaleMode(filtered.entities.length, phone)");
    for (const language of ["zh-TW", "en"]) expect(Object.keys(strings(language).graphZoom).sort()).toEqual(["all", "breadcrumb", "minRelations", "moreMembers", "other", "segments"]);
  });
});
