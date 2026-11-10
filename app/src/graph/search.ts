// 圖譜的找起點（#199）：搜尋名稱、類型篩選與「關聯最多」。
// 只在 readGraph() 回傳的可見圖上計算，不另外查詢，所以搜尋結果與起點清單只會有目前身分看得到的實體。
import type { AliasRules, EntityType } from "../client/types";
import { normalizeName } from "../extraction/merge";
import type { Graph, GraphEntity } from "./read";

export const SEARCH_LIMIT = 8;
export const TOP_LIMIT = 5;

// 找不到實體類型時（例如之後萃取的類型）一律忽略大小寫、全半形與空白
const LENIENT: AliasRules = { ignoreCase: true, normalizeWidth: true, ignoreWhitespace: true };

// 看得到的關聯數：兩端都看得到的關係才在可見圖中
export function relationCounts(graph: Graph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of graph.relations) for (const id of [r.from, r.to]) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

// 類型篩選：沒勾的類型的實體（變灰，並排除在搜尋與起點清單外）；types 為 null 時全選
export function excludedEntities(graph: Graph, types: ReadonlySet<string> | null): ReadonlySet<string> {
  return new Set(types === null ? [] : graph.entities.filter((e) => !types.has(e.type)).map((e) => e.id));
}

// 搜尋：以實體類型的 aliasRules 正規化後，比對主要名稱與各語言的顯示名稱（部分符合）。
// 名稱以查詢開頭的排前面，其次依介面語言的顯示名稱排序；最多 SEARCH_LIMIT 筆
export function searchEntities(
  graph: Graph,
  query: string,
  language: string,
  entityTypes: readonly Pick<EntityType, "id" | "aliasRules">[],
  types: ReadonlySet<string> | null = null,
): GraphEntity[] {
  if (query.trim() === "") return [];
  const excluded = excludedEntities(graph, types);
  const ranked = graph.entities.flatMap((e) => {
    if (excluded.has(e.id)) return [];
    const rules = entityTypes.find((t) => t.id === e.type)?.aliasRules ?? LENIENT;
    const q = normalizeName(query, rules);
    const names = [e.name, ...Object.values(e.names)].map((n) => normalizeName(n, rules));
    if (q === "" || !names.some((n) => n.includes(q))) return [];
    return [{ entity: e, prefix: names.some((n) => n.startsWith(q)) ? 0 : 1, label: e.names[language] || e.name }];
  });
  return ranked
    .sort((a, b) => a.prefix - b.prefix || a.label.localeCompare(b.label, language) || a.entity.id.localeCompare(b.entity.id))
    .slice(0, SEARCH_LIMIT)
    .map((r) => r.entity);
}

// 沒有選取時的起點：看得到的關聯數最多的 TOP_LIMIT 個（同數依顯示名稱）；沒有關聯的不列
export function topConnected(graph: Graph, language: string, types: ReadonlySet<string> | null = null): { entity: GraphEntity; count: number }[] {
  const counts = relationCounts(graph);
  const excluded = excludedEntities(graph, types);
  return graph.entities
    .filter((e) => !excluded.has(e.id) && (counts.get(e.id) ?? 0) > 0)
    .map((entity) => ({ entity, count: counts.get(entity.id)!, label: entity.names[language] || entity.name }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, language) || a.entity.id.localeCompare(b.entity.id))
    .slice(0, TOP_LIMIT)
    .map(({ entity, count }) => ({ entity, count }));
}
