// 多跳路徑：在 readGraph() 回傳的可見圖上找兩個實體之間的最短路徑（BFS，不分關係方向）。
// 可見圖已經過 RLS 篩選，所以路徑只會經過看得到的實體與關係。
import type { Graph } from "./read";

// 超過這個跳數的路徑不顯示（意義不大，也避免大圖上走太遠）
export const MAX_HOPS = 6;

// 第一步是起點，沒有 relation；之後每一步是經由 relation 到達的實體
export interface PathStep {
  entity: string;
  relation?: string;
}

// 起點或終點不在可見圖中、沒有連通、或超過 MAX_HOPS 時回 null；畫面不區分原因
export function shortestPath(graph: Graph, from: string, to: string): PathStep[] | null {
  const ids = new Set(graph.entities.map((e) => e.id));
  if (!ids.has(from) || !ids.has(to)) return null;

  const neighbors = new Map<string, { relation: string; entity: string }[]>();
  const link = (a: string, b: string, relation: string) => neighbors.set(a, [...(neighbors.get(a) ?? []), { relation, entity: b }]);
  for (const r of graph.relations) {
    if (!ids.has(r.from) || !ids.has(r.to)) continue;
    link(r.from, r.to, r.id);
    link(r.to, r.from, r.id);
  }
  // 多條最短路徑時，依（關係 id, 實體 id）的順序展開，結果固定
  for (const list of neighbors.values()) list.sort((a, b) => a.relation.localeCompare(b.relation) || a.entity.localeCompare(b.entity));

  const previous = new Map<string, PathStep | null>([[from, null]]);
  let frontier = [from];
  for (let hops = 0; hops < MAX_HOPS && !previous.has(to) && frontier.length > 0; hops++) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const { relation, entity } of neighbors.get(current) ?? []) {
        if (previous.has(entity)) continue;
        previous.set(entity, { entity: current, relation });
        next.push(entity);
      }
    }
    frontier = next;
  }
  if (!previous.has(to)) return null;

  const path: PathStep[] = [];
  for (let at: string | undefined = to; at !== undefined; ) {
    const back: PathStep | null = previous.get(at)!;
    path.unshift(back === null ? { entity: at } : { entity: at, relation: back.relation });
    at = back?.entity;
  }
  return path;
}
