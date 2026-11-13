// 展示模式的圖譜視角（#260 PR 3 審查）：標籤在畫面上的大小固定（graph-style.ts 的字級除以 zoom），節點本體與位置隨 zoom 放大。
// 選取後找一個 zoom：聚焦集合（含標籤）整個放進畫布，且彼此不重疊；有好幾個 zoom 可用時取最接近 1 的（節點維持原本的大小）。
// 任何 zoom 都會重疊時（版面中兩個鄰居靠得太近），把相連的實體排到選取實體周圍的橢圓上（保留原本的方向順序），
// 換焦點時 GraphView 把它們移回原位。純函式：GraphView 從 cytoscape 量出節點與標籤，這裡只做計算（presentation-camera.test.ts）。

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// 節點：position 是 model 座標；body 是本體相對於 position 的外框（model 單位，隨 zoom 放大）；
// label 是標籤相對於本體下緣中央的位移（畫面上的 px，不隨 zoom 改變）
export interface NodeShape {
  id: string;
  position: Point;
  body: Box;
  label: Box;
}

// 標上名稱的關係：label 是名稱相對於兩端中點的位移（畫面上的 px）
export interface EdgeShape {
  source: string;
  target: string;
  label: Box;
}

export interface CameraOptions {
  // 與畫布邊緣的距離、元素之間至少留的距離（畫面上的 px）
  padding: number;
  gap: number;
  minZoom: number;
  maxZoom: number;
}

export const CAMERA_DEFAULTS: CameraOptions = { padding: 24, gap: 6, minZoom: 0.3, maxZoom: 3 };

// 排成橢圓時試的起始角度數
const ROTATIONS = 12;

export interface Camera {
  zoom: number;
  pan: Point;
}

export interface Size {
  width: number;
  height: number;
}

type Positions = ReadonlyMap<string, Point>;

const shift = (b: Box, x: number, y: number): Box => ({ x1: b.x1 + x, y1: b.y1 + y, x2: b.x2 + x, y2: b.y2 + y });
const scale = (b: Box, z: number): Box => ({ x1: b.x1 * z, y1: b.y1 * z, x2: b.x2 * z, y2: b.y2 * z });
const union = (a: Box, b: Box): Box => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) });

// 節點連同標籤在畫面上的外框（pan 為 0 時）
export function nodeBox(node: NodeShape, at: Point, zoom: number): Box {
  const body = scale(shift(node.body, at.x, at.y), zoom);
  return union(body, shift(node.label, at.x * zoom, body.y2));
}

export function edgeBox(edge: EdgeShape, from: Point, to: Point, zoom: number): Box {
  return shift(edge.label, ((from.x + to.x) / 2) * zoom, ((from.y + to.y) / 2) * zoom);
}

export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return a.x1 < b.x2 + gap && b.x1 < a.x2 + gap && a.y1 < b.y2 + gap && b.y1 < a.y2 + gap;
}

const anyOverlap = (boxes: Box[], gap: number) => boxes.some((a, i) => boxes.slice(i + 1).some((b) => overlaps(a, b, gap)));

export interface View {
  camera: Camera;
  // 2：節點與關係名稱都不重疊；1：節點彼此不重疊；0：放得進畫布但會重疊（或放不進）
  clear: 0 | 1 | 2;
}

// 給定位置找 zoom：依序找 ①全部不重疊 ②節點不重疊 ③放得進畫布，每一輪取最接近 1 的 zoom；都找不到時用最小的 zoom。平移讓它們置中
export function presentationCamera(nodes: NodeShape[], edges: EdgeShape[], positions: Positions, size: Size, options: CameraOptions = CAMERA_DEFAULTS): View {
  if (nodes.length === 0) return { camera: { zoom: 1, pan: { x: size.width / 2, y: size.height / 2 } }, clear: 2 };
  const { padding, gap, minZoom, maxZoom } = options;
  const at = (id: string) => positions.get(id) ?? nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
  const zooms: number[] = [];
  for (let k = Math.ceil(Math.log(minZoom) / 0.04); Math.exp(k * 0.04) <= maxZoom; k++) zooms.push(Math.exp(k * 0.04));
  zooms.sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)));
  const candidates = zooms.map((zoom) => {
    const nodeBoxes = nodes.map((n) => nodeBox(n, at(n.id), zoom));
    const boxes = [...nodeBoxes, ...edges.map((e) => edgeBox(e, at(e.source), at(e.target), zoom))];
    const all = boxes.reduce(union);
    const fits = all.x2 - all.x1 <= size.width - 2 * padding && all.y2 - all.y1 <= size.height - 2 * padding;
    const clear = anyOverlap(nodeBoxes, gap) ? 0 : anyOverlap(boxes, gap) ? 1 : 2;
    return { zoom, all, fits, clear } as const;
  });
  const fitting = candidates.filter((c) => c.fits);
  const chosen =
    fitting.find((c) => c.clear === 2) ?? fitting.find((c) => c.clear === 1) ?? fitting[0] ?? candidates.reduce((a, b) => (a.zoom < b.zoom ? a : b));
  const { all } = chosen;
  return {
    camera: { zoom: chosen.zoom, pan: { x: size.width / 2 - (all.x1 + all.x2) / 2, y: size.height / 2 - (all.y1 + all.y2) / 2 } },
    clear: chosen.fits ? chosen.clear : 0,
  };
}

// 選取的實體不動，其他節點依原本相對於它的角度排序，等距排在橢圓上；橢圓以 zoom 1 時能放進畫布的大小為準
export function ring(nodes: NodeShape[], center: string, size: Size, rotation: number, options: CameraOptions = CAMERA_DEFAULTS): Map<string, Point> {
  const middle = nodes.find((n) => n.id === center);
  const around = nodes.filter((n) => n.id !== center);
  if (middle === undefined || around.length === 0) return new Map();
  const c = middle.position;
  const angle = (n: NodeShape) => Math.atan2(n.position.y - c.y, n.position.x - c.x);
  const sorted = [...around].sort((a, b) => angle(a) - angle(b));
  const boxes = around.map((n) => nodeBox(n, { x: 0, y: 0 }, 1));
  const [width, height] = [Math.max(...boxes.map((b) => b.x2 - b.x1)), Math.max(...boxes.map((b) => b.y2 - b.y1))];
  const rx = Math.min(Math.max((size.width - 2 * options.padding - width) / 2, width / 2 + options.gap), 2 * width);
  const ry = Math.min(Math.max((size.height - 2 * options.padding - height) / 2, height / 2 + options.gap), 2 * height);
  const start = angle(sorted[0]) + (rotation * 2 * Math.PI) / (ROTATIONS * sorted.length);
  return new Map(
    sorted.map((n, i) => {
      const t = start + (i * 2 * Math.PI) / sorted.length;
      return [n.id, { x: c.x + rx * Math.cos(t), y: c.y + ry * Math.sin(t) }];
    }),
  );
}

export interface Arrangement extends View {
  // 要移動的節點與新位置（不必移動時是空的）
  moved: Map<string, Point>;
}

// 先用原本的位置；有重疊時試排成橢圓（幾個起始角度），取最不重疊的，同樣不重疊時保留原本的位置
export function presentationArrangement(nodes: NodeShape[], edges: EdgeShape[], center: string | null, size: Size, options: CameraOptions = CAMERA_DEFAULTS): Arrangement {
  const original = { ...presentationCamera(nodes, edges, new Map(), size, options), moved: new Map<string, Point>() };
  if (original.clear === 2 || center === null) return original;
  let best: Arrangement = original;
  for (let r = 0; r < ROTATIONS && best.clear < 2; r++) {
    const moved = ring(nodes, center, size, r, options);
    const view = presentationCamera(nodes, edges, moved, size, options);
    if (view.clear > best.clear) best = { ...view, moved };
  }
  return best;
}
