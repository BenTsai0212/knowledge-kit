// 圖譜的逐步展開（#199）：狀態是已展開的路徑（實體 id 的陣列，例如 [A, B]），空陣列＝全部（沒有選取）。
// 只在 readGraph() 回傳的可見圖上計算，不另外查詢，所以聚焦、變灰與展開都只涉及看得到的實體與關係。
import type { Graph } from "./read";

export type Expansion = readonly string[];

// 回到全部
export const ALL: Expansion = [];

// 只看它：從它重新開始
export const only = (entityId: string): Expansion => [entityId];

// 選取的節點＝路徑的最後一個；全部時沒有選取
export const selectedOf = (expansion: Expansion): string | null => expansion.at(-1) ?? null;

export interface Focus {
  entities: ReadonlySet<string>;
  relations: ReadonlySet<string>;
}

// 聚焦集合：路徑上的節點＋它們的直接鄰居，以及這些節點之間的關係；全部時回 null（不變灰）
export function focusOf(graph: Graph, expansion: Expansion): Focus | null {
  if (expansion.length === 0) return null;
  const path = new Set(expansion);
  const entities = new Set(expansion);
  for (const r of graph.relations) {
    if (path.has(r.from)) entities.add(r.to);
    if (path.has(r.to)) entities.add(r.from);
  }
  const relations = new Set(graph.relations.filter((r) => entities.has(r.from) && entities.has(r.to)).map((r) => r.id));
  return { entities, relations };
}

// 點節點：已在路徑上時截到該處；在聚焦集合中時接在路徑後面；全部時或點變灰的節點時，等同「只看它」
export function expand(graph: Graph, expansion: Expansion, entityId: string): Expansion {
  const at = expansion.indexOf(entityId);
  if (at >= 0) return expansion.slice(0, at + 1);
  const focus = focusOf(graph, expansion);
  return focus?.entities.has(entityId) ? [...expansion, entityId] : only(entityId);
}

// 切換身分後：路徑截到第一個看不到的實體之前（後面的展開是從它出發的，不再成立）
export function keepVisible(graph: Graph, expansion: Expansion): Expansion {
  const ids = new Set(graph.entities.map((e) => e.id));
  const end = expansion.findIndex((id) => !ids.has(id));
  return end < 0 ? expansion : expansion.slice(0, end);
}

// 選取節點的相連關係：只在這些關係上顯示關係名稱
export function nearRelations(graph: Graph, selected: string | null): ReadonlySet<string> {
  return new Set(graph.relations.filter((r) => r.from === selected || r.to === selected).map((r) => r.id));
}
