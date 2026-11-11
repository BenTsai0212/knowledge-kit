// 入口頁主視覺的版面（#228，docs/design.md「入口頁主視覺」）：純函式，畫法在 EntryHero.tsx、動態在 app.css。
// 座標都在 0–100 的 viewBox 內；亂數用固定種子，同一份資料每次畫出相同的圖。
import type { EntityIconName } from "../client/types";

export interface Point {
  x: number;
  y: number;
}

export type HeroShape = "circle" | "block" | "tile";

export interface HeroNode extends Point {
  id: string;
  type: string;
  shape: HeroShape;
  // 關係最多的 3 個節點週期性發出光暈
  core: boolean;
}

export interface HeroLink {
  from: number;
  to: number;
}

export interface HeroScene {
  far: Point[];
  farLinks: HeroLink[];
  mid: Point[];
  midLinks: HeroLink[];
  front: HeroNode[];
  // 前景的關係
  links: HeroLink[];
  // 週期性形成又淡去的新連線：兩端原本沒有關係
  forming: HeroLink[];
}

export interface HeroInput {
  entities: readonly { id: string; type: string }[];
  relations: readonly { from: string; to: string }[];
  types: readonly { id: string; icon: EntityIconName }[];
}

// 三層的節點數（docs/design.md）；低階裝置減少遠景與中景
export const HERO_COUNTS = { far: 26, mid: 16, front: 18 } as const;
export const HERO_LITE_COUNTS = { far: 10, mid: 8, front: 18 } as const;
// 每隔 2.5 秒形成一條新連線，4 條輪流（app.css 的 kForm 週期是 4 × 2.5 秒）
export const FORMING_COUNT = 4;
const CORE_COUNT = 3;
const SEED = 228;
// 前景留邊，節點不貼著畫面邊緣
const MARGIN = 14;

// 人員圓形、部門圓角方形、專案小圓角方形（docs/design.md「實體顏色」）；其他圖示依性質歸類
const SHAPES: Record<EntityIconName, HeroShape> = {
  person: "circle",
  handshake: "circle",
  generic: "circle",
  team: "block",
  building: "block",
  factory: "block",
  hospital: "block",
  folder: "tile",
  box: "tile",
  gavel: "tile",
  document: "tile",
};

export const heroShape = (icon: EntityIconName | undefined): HeroShape => SHAPES[icon ?? "generic"];

// mulberry32：小而固定的亂數，回傳 [0, 1)
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scatter(count: number, random: () => number): Point[] {
  return Array.from({ length: count }, () => ({ x: 4 + random() * 92, y: 4 + random() * 92 }));
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// 每個點連到最近的兩個鄰居，重複的線只留一條
export function nearestLinks(points: readonly Point[], neighbors = 2): HeroLink[] {
  const seen = new Set<string>();
  const links: HeroLink[] = [];
  points.forEach((p, i) => {
    const nearest = points
      .map((q, j) => ({ j, d: distance(p, q) }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d || a.j - b.j)
      .slice(0, neighbors);
    for (const { j } of nearest) {
      if (seen.has(key(i, j))) continue;
      seen.add(key(i, j));
      links.push({ from: Math.min(i, j), to: Math.max(i, j) });
    }
  });
  return links;
}

// 簡單的力導向排版（固定迭代次數），再縮放到留邊後的範圍
export function forceLayout(count: number, links: readonly HeroLink[], random: () => number, iterations = 240): Point[] {
  const pos = Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / Math.max(count, 1);
    return { x: 50 + 30 * Math.cos(angle) + random() * 4, y: 50 + 30 * Math.sin(angle) + random() * 4 };
  });
  const k = 100 / Math.sqrt(Math.max(count, 1)) / 1.6;
  for (let step = 0; step < iterations; step++) {
    const move = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = pos[i].x - pos[j].x || 0.01;
        const dy = pos[i].y - pos[j].y;
        const d = Math.max(Math.hypot(dx, dy), 0.01);
        const f = (k * k) / d / d;
        move[i].x += dx * f;
        move[i].y += dy * f;
        move[j].x -= dx * f;
        move[j].y -= dy * f;
      }
    }
    for (const { from, to } of links) {
      const dx = pos[from].x - pos[to].x;
      const dy = pos[from].y - pos[to].y;
      const d = Math.max(Math.hypot(dx, dy), 0.01);
      const f = d / k;
      move[from].x -= dx * f;
      move[from].y -= dy * f;
      move[to].x += dx * f;
      move[to].y += dy * f;
    }
    // 拉向中心，沒有關係的節點不會飄走
    const temperature = 4 * (1 - step / iterations) + 0.1;
    pos.forEach((p, i) => {
      move[i].x += (50 - p.x) * 0.4;
      move[i].y += (50 - p.y) * 0.4;
      const length = Math.max(Math.hypot(move[i].x, move[i].y), 0.01);
      p.x += (move[i].x / length) * Math.min(length, temperature);
      p.y += (move[i].y / length) * Math.min(length, temperature);
    });
  }
  return fit(pos);
}

function fit(points: Point[]): Point[] {
  if (points.length === 0) return points;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1);
  const scale = (100 - 2 * MARGIN) / span;
  const offsetX = (100 - (Math.max(...xs) - minX) * scale) / 2;
  const offsetY = (100 - (Math.max(...ys) - minY) * scale) / 2;
  return points.map((p) => ({ x: offsetX + (p.x - minX) * scale, y: offsetY + (p.y - minY) * scale }));
}

export function heroScene(input: HeroInput, lite = false): HeroScene {
  const counts = lite ? HERO_LITE_COUNTS : HERO_COUNTS;
  const random = seededRandom(SEED);
  const far = scatter(counts.far, random);
  const mid = scatter(counts.mid, random);

  // 前景：關係最多的實體優先（同數時依資料順序），只畫兩端都在前景的關係
  const degree = new Map<string, number>();
  for (const r of input.relations) {
    degree.set(r.from, (degree.get(r.from) ?? 0) + 1);
    degree.set(r.to, (degree.get(r.to) ?? 0) + 1);
  }
  const chosen = input.entities
    .map((e, order) => ({ e, order, degree: degree.get(e.id) ?? 0 }))
    .sort((a, b) => b.degree - a.degree || a.order - b.order)
    .slice(0, counts.front)
    .sort((a, b) => a.order - b.order);
  const index = new Map(chosen.map(({ e }, i) => [e.id, i]));
  const seen = new Set<string>();
  const links: HeroLink[] = [];
  for (const r of input.relations) {
    const [from, to] = [index.get(r.from), index.get(r.to)];
    if (from === undefined || to === undefined || from === to || seen.has(key(from, to))) continue;
    seen.add(key(from, to));
    links.push({ from, to });
  }
  const positions = forceLayout(chosen.length, links, random);
  const core = new Set(
    chosen
      .map((c, i) => ({ i, degree: c.degree }))
      .sort((a, b) => b.degree - a.degree || a.i - b.i)
      .slice(0, CORE_COUNT)
      .filter((c) => c.degree > 0)
      .map((c) => c.i),
  );
  const icons = new Map(input.types.map((t) => [t.id, t.icon]));
  const front = chosen.map(({ e }, i) => ({ id: e.id, type: e.type, shape: heroShape(icons.get(e.type)), core: core.has(i), ...positions[i] }));

  return { far, farLinks: nearestLinks(far), mid, midLinks: nearestLinks(mid), front, links, forming: formingLinks(front.length, seen, random) };
}

// 兩端原本沒有關係的節點對，依固定亂數挑出，不重複
function formingLinks(count: number, connected: ReadonlySet<string>, random: () => number): HeroLink[] {
  const candidates: HeroLink[] = [];
  for (let from = 0; from < count; from++) for (let to = from + 1; to < count; to++) if (!connected.has(key(from, to))) candidates.push({ from, to });
  const picked: HeroLink[] = [];
  while (picked.length < FORMING_COUNT && candidates.length > 0) picked.push(candidates.splice(Math.floor(random() * candidates.length), 1)[0]);
  return picked;
}

// 低階裝置（CPU 核心數或記憶體少）：減少遠景與中景、不模糊。瀏覽器沒有提供時視為一般裝置
export function isLowEnd(device: { hardwareConcurrency?: number; deviceMemory?: number }): boolean {
  return (device.hardwareConcurrency !== undefined && device.hardwareConcurrency <= 4) || (device.deviceMemory !== undefined && device.deviceMemory <= 4);
}
