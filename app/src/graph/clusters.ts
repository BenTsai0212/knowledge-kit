// 大量節點時的圖譜（#254，docs/design.md「大量節點時的圖譜」）：門檻、分群、聚合線與泡泡的大小。
// 只在 readGraph() 回傳的可見圖上計算，不另外查詢，所以群組的實體數與聚合線的段數只涉及目前身分看得到的實體與關係（#247）。
import type { EntityType } from "../client/types";
import type { Graph, GraphRelation } from "./read";
import { relationCounts } from "./search";

// 可見節點數超過門檻時從全覽開始（桌機 60、手機 ≤ 600px 為 30）
export const SCALE_THRESHOLD = { desktop: 60, mobile: 30 } as const;

export type ScaleMode = "all" | "overview";

export function scaleMode(count: number, mobile: boolean): ScaleMode {
  return count > (mobile ? SCALE_THRESHOLD.mobile : SCALE_THRESHOLD.desktop) ? "overview" : "all";
}

export interface GraphFilters {
  // 勾選的實體類型；null 為全選（與 search.ts 的類型篩選相同）
  types: ReadonlySet<string> | null;
  // 「只顯示關聯 ≥ N」：0 為不篩選
  minRelations: number;
}

export const NO_FILTERS: GraphFilters = { types: null, minRelations: 0 };

// 篩選後的圖：沒勾的類型與關聯數（在可見圖上計算，與節點大小相同）小於 N 的實體拿掉，只留下兩端都還在的關係。
// 門檻以這張圖的實體數重新計算
export function filterGraph(graph: Graph, filters: GraphFilters): Graph {
  const counts = relationCounts(graph);
  const kept = new Set(
    graph.entities
      .filter((e) => (filters.types === null || filters.types.has(e.type)) && (counts.get(e.id) ?? 0) >= filters.minRelations)
      .map((e) => e.id),
  );
  return {
    entities: graph.entities.filter((e) => kept.has(e.id)),
    relations: graph.relations.filter((r) => kept.has(r.from) && kept.has(r.to)),
  };
}

// 分群用到的知識模型：實體類型的順序與 container
export type ClusterModel = { entityTypes: readonly Pick<EntityType, "id" | "container">[] };

// container：以容器實體分群（群組名稱是容器本身）；community：社群偵測（群組名稱是群內關聯最多的實體）；
// other：連不到任何容器、或沒有任何關係的實體（群組名稱放在 client/i18n/）
export type ClusterKind = "container" | "community" | "other";

export const OTHER_CLUSTER = "other";

export interface Cluster {
  id: string;
  kind: ClusterKind;
  // 代表實體：容器本身或群內關聯最多的實體；「其他」為 null
  anchor: string | null;
  // 群內的實體 id（依 id 排序）
  members: string[];
  // 群內的類型組成：實體數多的在前（同數依知識模型的順序），最多 3 個
  composition: { type: string; count: number }[];
}

export interface Clustering {
  clusters: Cluster[];
  // 實體 id → 群組 id
  clusterOf: ReadonlyMap<string, string>;
}

// 社群偵測的上限次數（通常幾輪內就不再移動）
const MAX_ROUNDS = 20;
const COMPOSITION_LIMIT = 3;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// 鄰居與兩者之間的關係數（不分方向，自己連到自己的不算）
function neighbours(relations: readonly GraphRelation[], ids: ReadonlySet<string>): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>([...ids].map((id) => [id, new Map()]));
  for (const r of relations) {
    if (r.from === r.to || !ids.has(r.from) || !ids.has(r.to)) continue;
    for (const [a, b] of [
      [r.from, r.to],
      [r.to, r.from],
    ] as const) {
      const m = map.get(a)!;
      m.set(b, (m.get(b) ?? 0) + 1);
    }
  }
  return map;
}

// 分群：知識模型有 container 類型、且圖中看得到這些類型的實體時依容器分群，否則以社群偵測分群。
// 同一份資料每次結果相同，與實體、關係的順序無關
export function clusterGraph(graph: Graph, model: ClusterModel): Clustering {
  const ids = new Set(graph.entities.map((e) => e.id));
  const near = neighbours(graph.relations, ids);
  const containerTypes = model.entityTypes.filter((t) => t.container === true).map((t) => t.id);
  const hasContainer = graph.entities.some((e) => containerTypes.includes(e.type));
  const groups = hasContainer ? byContainer(graph, near, containerTypes) : byCommunity(near);
  return finish(graph, model, groups);
}

interface Group {
  id: string;
  kind: ClusterKind;
  anchor: string | null;
  members: string[];
}

// 容器分群：每個容器實體自成一群；其他實體歸入直接相連的容器，
// 屬於多群時依「容器類型在知識模型中的順序 → 與容器之間的關係數（多的優先）→ 容器 id」決定
function byContainer(graph: Graph, near: Map<string, Map<string, number>>, containerTypes: readonly string[]): Group[] {
  const typeOf = new Map(graph.entities.map((e) => [e.id, e.type]));
  const rank = (id: string) => containerTypes.indexOf(typeOf.get(id)!);
  const containers = graph.entities.filter((e) => containerTypes.includes(e.type)).map((e) => e.id);
  const members = new Map<string, string[]>(containers.map((id) => [id, [id]]));
  const other: string[] = [];
  for (const e of graph.entities) {
    if (members.has(e.id)) continue;
    const candidates = [...near.get(e.id)!.entries()].filter(([id]) => members.has(id));
    if (candidates.length === 0) {
      other.push(e.id);
      continue;
    }
    candidates.sort(([a, ca], [b, cb]) => rank(a) - rank(b) || cb - ca || byId(a, b));
    members.get(candidates[0]![0])!.push(e.id);
  }
  return [
    ...[...members.entries()].map(([id, list]) => ({ id, kind: "container" as const, anchor: id, members: list })),
    ...(other.length > 0 ? [{ id: OTHER_CLUSTER, kind: "other" as const, anchor: null, members: other }] : []),
  ];
}

// 社群偵測（模組度的局部移動，Louvain 法的第一階段）：一開始每個實體自成一群，依 id 順序逐一移到模組度增加最多的相鄰群組
// （增加相同時留在原群組，其次取 id 較小的群組）；一輪沒有移動或達到上限次數就停止，所以結果固定。沒有任何關係的實體放進「其他」
function byCommunity(near: Map<string, Map<string, number>>): Group[] {
  const order = [...near.keys()].sort(byId);
  const degree = (id: string) => [...near.get(id)!.values()].reduce((a, b) => a + b, 0);
  const total = order.reduce((n, id) => n + degree(id), 0);
  const label = new Map(order.map((id) => [id, id]));
  const sum = new Map(order.map((id) => [id, degree(id)]));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = false;
    for (const id of order) {
      const k = degree(id);
      if (k === 0) continue;
      const current = label.get(id)!;
      sum.set(current, sum.get(current)! - k);
      const links = new Map<string, number>();
      for (const [other, n] of near.get(id)!) links.set(label.get(other)!, (links.get(label.get(other)!) ?? 0) + n);
      const gain = (c: string) => (links.get(c) ?? 0) - (sum.get(c)! * k) / total;
      let best = current;
      for (const c of [...links.keys()].sort(byId)) if (gain(c) > gain(best) + 1e-9) best = c;
      sum.set(best, sum.get(best)! + k);
      if (best !== current) {
        label.set(id, best);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const communities = new Map<string, string[]>();
  const other: string[] = [];
  for (const id of order) {
    if (near.get(id)!.size === 0) other.push(id);
    else {
      const c = label.get(id)!;
      communities.set(c, (communities.get(c) ?? []).concat(id));
    }
  }
  return [
    ...[...communities.values()].map((list) => {
      const anchor = [...list].sort((a, b) => degree(b) - degree(a) || byId(a, b))[0]!;
      return { id: `community:${anchor}`, kind: "community" as const, anchor, members: list };
    }),
    ...(other.length > 0 ? [{ id: OTHER_CLUSTER, kind: "other" as const, anchor: null, members: other }] : []),
  ];
}

// 群組依實體數由多到少（同數依 id），「其他」排最後；群內依 id 排序
function finish(graph: Graph, model: ClusterModel, groups: Group[]): Clustering {
  const typeOf = new Map(graph.entities.map((e) => [e.id, e.type]));
  const typeRank = (type: string) => {
    const i = model.entityTypes.findIndex((t) => t.id === type);
    return i < 0 ? model.entityTypes.length : i;
  };
  const clusters = groups
    .map((g): Cluster => {
      const members = [...g.members].sort(byId);
      const counts = new Map<string, number>();
      for (const id of members) counts.set(typeOf.get(id)!, (counts.get(typeOf.get(id)!) ?? 0) + 1);
      const composition = [...counts.entries()]
        .sort(([a, ca], [b, cb]) => cb - ca || typeRank(a) - typeRank(b) || byId(a, b))
        .slice(0, COMPOSITION_LIMIT)
        .map(([type, count]) => ({ type, count }));
      return { ...g, members, composition };
    })
    .sort((a, b) => Number(a.kind === "other") - Number(b.kind === "other") || b.members.length - a.members.length || byId(a.id, b.id));
  const clusterOf = new Map(clusters.flatMap((c) => c.members.map((id) => [id, c.id] as const)));
  return { clusters, clusterOf };
}

export interface AggregateEdge {
  // 兩端的群組 id（from < to）
  from: string;
  to: string;
  // 兩群之間看得到的關係（依 id 排序）；段數＝relations.length
  relations: string[];
}

// 兩群之間的關係（不分方向）：2 段以上時畫成一條聚合線並標上段數，1 段時照常畫成一條線
export function aggregateEdges(graph: Graph, clustering: Clustering): AggregateEdge[] {
  const pairs = new Map<string, AggregateEdge>();
  for (const r of graph.relations) {
    const a = clustering.clusterOf.get(r.from);
    const b = clustering.clusterOf.get(r.to);
    if (a === undefined || b === undefined || a === b) continue;
    const [from, to] = byId(a, b) < 0 ? [a, b] : [b, a];
    const key = `${from}\u0000${to}`;
    const edge = pairs.get(key) ?? { from, to, relations: [] };
    edge.relations.push(r.id);
    pairs.set(key, edge);
  }
  return [...pairs.values()]
    .map((e) => ({ ...e, relations: e.relations.sort(byId) }))
    .sort((a, b) => byId(a.from, b.from) || byId(a.to, b.to));
}

// 2 段以上才合併成聚合線
export const isAggregated = (edge: AggregateEdge): boolean => edge.relations.length >= 2;

// 泡泡直徑（px）：44 + 12 × √實體數
export const bubbleDiameter = (members: number): number => 44 + 12 * Math.sqrt(members);

// 聚合線寬（px）：1 + 0.45 × 段數
export const aggregateWidth = (segments: number): number => 1 + 0.45 * segments;

// 第 2 層顯示標籤的節點：群內關聯數（在可見圖上計算）前 10%（至少 1 個，同數依 id），加上選取的節點
export function labelledInCluster(graph: Graph, cluster: Pick<Cluster, "members">, selected: string | null = null): ReadonlySet<string> {
  const counts = relationCounts(graph);
  const top = Math.max(1, Math.ceil(cluster.members.length * 0.1));
  const ranked = [...cluster.members].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || byId(a, b)).slice(0, top);
  return new Set(selected !== null && cluster.members.includes(selected) ? [...ranked, selected] : ranked);
}
