import { describe, expect, it } from "vitest";
import {
  CAMERA_DEFAULTS,
  edgeBox,
  nodeBox,
  overlaps,
  presentationArrangement,
  presentationCamera,
  ring,
  type Box,
  type EdgeShape,
  type NodeShape,
  type Point,
} from "./presentation-camera";

// 節點：model 座標 (x, y)、大小 size；標籤在本體下方 6px，畫面上寬 width、高 height（不隨 zoom 改變）
const node = (id: string, x: number, y: number, size = 40, width = 168, height = 50): NodeShape => ({
  id,
  position: { x, y },
  body: { x1: -size / 2, y1: -size / 2, x2: size / 2, y2: size / 2 },
  label: { x1: -width / 2, y1: 6, x2: width / 2, y2: 6 + height },
});
// 關係名稱：在兩端的中點，畫面上寬 40、高 22
const edge = (source: string, target: string): EdgeShape => ({ source, target, label: { x1: -20, y1: -11, x2: 20, y2: 11 } });
const canvas = { width: 650, height: 480 };

// 依結果換算成畫布上的外框
const placed = (nodes: NodeShape[], edges: EdgeShape[], center: string | null, size = canvas) => {
  const result = presentationArrangement(nodes, edges, center, size);
  const { zoom, pan } = result.camera;
  const at = (id: string): Point => result.moved.get(id) ?? nodes.find((n) => n.id === id)!.position;
  const move = (b: Box) => ({ x1: b.x1 + pan.x, y1: b.y1 + pan.y, x2: b.x2 + pan.x, y2: b.y2 + pan.y });
  return {
    ...result,
    nodeBoxes: nodes.map((n) => move(nodeBox(n, at(n.id), zoom))),
    edgeBoxes: edges.map((e) => move(edgeBox(e, at(e.source), at(e.target), zoom))),
  };
};
const inside = (b: Box, size = canvas) => b.x1 >= 0 && b.y1 >= 0 && b.x2 <= size.width && b.y2 <= size.height;
const separate = (boxes: Box[]) => boxes.every((a, i) => boxes.slice(i + 1).every((b) => !overlaps(a, b)));

describe("展示模式的圖譜視角（#260 PR 3 審查）", () => {
  it("標籤的畫面大小不隨 zoom 改變，本體與位置隨 zoom 放大", () => {
    const item = node("a", 100, 0);
    expect(nodeBox(item, item.position, 1)).toEqual({ x1: 16, y1: -20, x2: 184, y2: 76 });
    // zoom 2：本體 80px，標籤仍是 168×50，掛在本體下緣
    expect(nodeBox(item, item.position, 2)).toEqual({ x1: 116, y1: -40, x2: 284, y2: 96 });
  });

  it("擠在一起的節點：放大到標籤不重疊，且整個放在畫布內、置中，節點不移動", () => {
    // 一排三個節點相距 100（zoom 1 時 168px 寬的標籤會互相重疊），中間的下方再一個
    const nodes = [node("a", -100, 0), node("b", 0, 0, 56), node("c", 100, 0), node("d", 0, 100)];
    expect(separate(nodes.map((n) => nodeBox(n, n.position, 1)))).toBe(false);
    const result = placed(nodes, [], "b");
    expect(result.camera.zoom).toBeGreaterThan(1);
    expect(result.moved.size).toBe(0);
    expect(result.clear).toBe(2);
    expect(separate(result.nodeBoxes)).toBe(true);
    for (const b of result.nodeBoxes) expect(inside(b)).toBe(true);
    const [left, right] = [Math.min(...result.nodeBoxes.map((b) => b.x1)), Math.max(...result.nodeBoxes.map((b) => b.x2))];
    expect(left + right).toBeCloseTo(canvas.width);
  });

  it("散得很開的節點：縮小到整個放進畫布", () => {
    const result = placed([node("a", -500, 0), node("b", 500, 0), node("c", 0, 400)], [], "a");
    expect(result.camera.zoom).toBeLessThan(1);
    expect(result.moved.size).toBe(0);
    expect(separate(result.nodeBoxes)).toBe(true);
    for (const b of result.nodeBoxes) expect(inside(b)).toBe(true);
  });

  it("可以時維持 zoom 1（節點是原本的大小），與畫布邊緣留 padding", () => {
    const result = placed([node("a", 0, 0), node("b", 250, 0), node("c", 0, 150)], [], "a");
    expect(result.camera.zoom).toBe(1);
    const { padding } = CAMERA_DEFAULTS;
    for (const b of result.nodeBoxes) expect(b.x1 >= padding && b.y1 >= padding && b.x2 <= canvas.width - padding && b.y2 <= canvas.height - padding).toBe(true);
  });

  it("關係名稱也不壓在節點標籤上", () => {
    const nodes = [node("a", 0, 0), node("b", 0, 120)];
    const result = placed(nodes, [edge("a", "b")], "a");
    expect(result.clear).toBe(2);
    expect(separate([...result.nodeBoxes, ...result.edgeBoxes])).toBe(true);
  });

  it("任何 zoom 都會重疊時（兩個鄰居疊在一起），相連的實體排到選取實體周圍的橢圓上", () => {
    // 星形：中心與 5 個鄰居，其中兩個幾乎在同一個位置
    const nodes = [node("hub", 0, 0, 56), node("n1", 80, 0), node("n2", 82, 2), node("n3", -80, 0), node("n4", 0, 80), node("n5", 0, -80)];
    const edges = nodes.slice(1).map((n) => edge("hub", n.id));
    expect(presentationCamera(nodes, edges, new Map(), canvas).clear).toBe(0);
    const result = placed(nodes, edges, "hub");
    expect(result.moved.has("hub")).toBe(false);
    expect(result.moved.size).toBe(5);
    expect(result.clear).toBeGreaterThanOrEqual(1);
    expect(separate(result.nodeBoxes)).toBe(true);
    for (const b of result.nodeBoxes) expect(inside(b)).toBe(true);
  });

  it("橢圓保留鄰居原本的方向順序", () => {
    const nodes = [node("hub", 0, 0), node("east", 100, 0), node("south", 0, 100), node("west", -100, 0), node("north", 0, -100)];
    const at = ring(nodes, "hub", canvas, 0);
    const angle = (id: string) => Math.atan2(at.get(id)!.y, at.get(id)!.x);
    expect(["west", "south", "north", "east"].sort((x, y) => angle(x) - angle(y))).toEqual(["north", "east", "south", "west"]);
    expect(at.has("hub")).toBe(false);
  });

  it("沒有元素時不改變；沒有選取時不移動節點", () => {
    expect(presentationCamera([], [], new Map(), canvas).camera).toEqual({ zoom: 1, pan: { x: 325, y: 240 } });
    const nodes = [node("a", 0, 0), node("b", 2, 2)];
    expect(presentationArrangement(nodes, [], null, canvas).moved.size).toBe(0);
  });
});
