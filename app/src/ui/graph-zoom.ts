// 大量節點時的三層語意縮放（#254，docs/design.md「大量節點時的圖譜」）：層級、細節層的範圍與畫在圖上的元素。
// 只用篩選後的可見圖與它的分群（clusters.ts）計算，泡泡的實體數與聚合線的段數只涉及目前身分看得到的內容（#247）。
import { type Cluster, type Clustering } from "../graph/clusters";
import type { Graph } from "../graph/read";

export type ZoomLevel = "overview" | "cluster" | "detail";

// 第 2、3 層的其他群組：60px、75% 不透明，停在畫面邊緣
export const SIDE_BUBBLE = 60;
export const SIDE_BUBBLE_OPACITY = 0.75;
// 細節層的二度關聯：45% 不透明、虛線
export const SECOND_OPACITY = 0.45;
// 畫在圖上的節點超過這個數量時，關閉展開的動態與 transition，拖曳與縮放時不畫標籤
export const CALM_LIMIT = 150;

// 選取的實體在分群中時是細節層（群組是它所屬的群），否則有展開的群組時是群組層，都沒有時是全覽
export function zoomLevel(clustering: Clustering, cluster: string | null, selected: string | null): { level: ZoomLevel; cluster: string | null } {
  const of = selected === null ? undefined : clustering.clusterOf.get(selected);
  if (of !== undefined) return { level: "detail", cluster: of };
  if (cluster !== null && clustering.clusters.some((c) => c.id === cluster)) return { level: "cluster", cluster };
  return { level: "overview", cluster: null };
}

export interface Detail {
  // 直接關係與另一端的實體
  direct: Set<string>;
  near: Set<string>;
  // 二度關聯：連到直接相關實體的其他關係與另一端的實體
  second: Set<string>;
  secondEntities: Set<string>;
  // 群內不在兩跳以內的成員（收成「＋N 位成員 · 展開」）
  collapsed: string[];
}

// 容器分群時不經過容器本身往外找二度關聯（否則群內每個成員都在兩跳以內）
export function detailOf(graph: Graph, cluster: Pick<Cluster, "members" | "kind" | "anchor">, selected: string): Detail {
  const hub = cluster.kind === "container" ? cluster.anchor : null;
  const direct = new Set<string>();
  const near = new Set<string>();
  for (const r of graph.relations) {
    if (r.from !== selected && r.to !== selected) continue;
    direct.add(r.id);
    const other = r.from === selected ? r.to : r.from;
    if (other !== selected) near.add(other);
  }
  const second = new Set<string>();
  const secondEntities = new Set<string>();
  for (const r of graph.relations) {
    const via = [r.from, r.to].filter((id) => near.has(id) && id !== hub);
    if (direct.has(r.id) || via.length === 0) continue;
    second.add(r.id);
    for (const id of [r.from, r.to]) if (id !== selected && !near.has(id)) secondEntities.add(id);
  }
  const collapsed = cluster.members.filter((id) => id !== selected && !near.has(id) && !secondEntities.has(id));
  return { direct, near, second, secondEntities, collapsed };
}

// 畫在圖上的實體：全覽沒有；群組層是群內全部；細節層是選取的實體、直接與二度相關的實體（可能在別的群），
// 「展開」後再加上群內其他成員
export function openEntities(level: ZoomLevel, cluster: Cluster | undefined, selected: string | null, detail: Detail | null, showMembers: boolean): Set<string> {
  if (level === "overview" || cluster === undefined) return new Set();
  if (level === "cluster" || selected === null || detail === null) return new Set(cluster.members);
  return new Set([selected, ...detail.near, ...detail.secondEntities, ...(showMembers ? cluster.members : [])]);
}

export const bubbleId = (cluster: string) => `cluster:${cluster}`;

export interface ViewEdge {
  // 1 段：關係 id；2 段以上：聚合線
  id: string;
  // 第一段關係的起點與終點所在（1 段時就是那段關係的方向）
  source: string;
  target: string;
  relations: string[];
}

export interface View {
  entities: string[];
  // 有成員沒畫成實體的群組（泡泡）
  bubbles: string[];
  edges: ViewEdge[];
}

// 圖上的元素：open 的實體照常畫，其他實體併入所屬群組的泡泡（hidden 的實體不畫，也不併入泡泡）。
// 兩端相同的關係（同一個泡泡內）不畫；兩端之間 2 段以上時合併成一條聚合線，1 段照常畫成那段關係
export function viewOf(graph: Graph, clustering: Clustering, open: ReadonlySet<string>, hidden: ReadonlySet<string> = new Set()): View {
  const at = (id: string) => {
    if (hidden.has(id)) return undefined;
    if (open.has(id)) return id;
    const c = clustering.clusterOf.get(id);
    return c === undefined ? undefined : bubbleId(c);
  };
  const pairs = new Map<string, ViewEdge>();
  for (const r of graph.relations) {
    const [a, b] = [at(r.from), at(r.to)];
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    const edge = pairs.get(key) ?? { id: "", source: a, target: b, relations: [] };
    edge.relations.push(r.id);
    pairs.set(key, edge);
  }
  const edges = [...pairs.values()].map((e) => {
    const relations = [...e.relations].sort();
    return { ...e, relations, id: relations.length === 1 ? `relation:${relations[0]}` : `aggregate:${e.source}|${e.target}` };
  });
  const bubbles = clustering.clusters.filter((c) => c.members.some((id) => !open.has(id) && !hidden.has(id))).map((c) => c.id);
  return { entities: graph.entities.map((e) => e.id).filter((id) => open.has(id) && !hidden.has(id)), bubbles, edges };
}

// 其他群組停在已排好的節點外圍：以節點範圍的中心為圓心，從正上方順時針平均分布
export function ringPositions(box: { x1: number; y1: number; x2: number; y2: number }, count: number, margin = SIDE_BUBBLE): { x: number; y: number }[] {
  const [cx, cy] = [(box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2];
  const radius = Math.max(box.x2 - box.x1, box.y2 - box.y1) / 2 + margin;
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

// 麵包屑「全部 › 群組 › 實體」：依層級列出要顯示的段
export function breadcrumb(level: ZoomLevel, cluster: string | null, selected: string | null): { kind: "all" | "cluster" | "entity"; id: string | null }[] {
  return [
    { kind: "all" as const, id: null },
    ...(level !== "overview" && cluster !== null ? [{ kind: "cluster" as const, id: cluster }] : []),
    ...(level === "detail" && selected !== null ? [{ kind: "entity" as const, id: selected }] : []),
  ];
}
