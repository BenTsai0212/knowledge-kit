// 同名的反問（ADR 0012 決定 1，docs/qa.md「同名」）：問題提到的名稱對應到目前身分看得到的 2 個以上同類型、同顯示名稱的實體時，
// 回答前先反問，不呼叫模型。輸入一律是送出身分的 readGraph() 結果（RLS 已篩選），看不到的那一位不會成為選項（#247）。
import type { Graph, GraphEntity } from "../graph/read";
import { entityName, entityOptionLabel } from "./graph-labels";

export interface SameNameOption {
  entityId: string;
  // entityOptionLabel() 的區分，與搜尋結果、圖上節點、「接著問」相同（#380 決定 1）
  label: string;
  // 選了之後送出的問題：問題中的名稱換成 label
  text: string;
}

export interface SameNameAsk {
  // 介面語言的顯示名稱
  name: string;
  options: SameNameOption[];
}

interface Hit {
  entity: GraphEntity;
  at: number;
  length: number;
}

// 名稱在問題中最早出現的位置與長度（不分大小寫；主要名稱與各語言的顯示名稱任一出現即可）
function hitOf(lower: string, entity: GraphEntity): Hit | null {
  let best: Hit | null = null;
  for (const name of [entity.name, ...Object.values(entity.names)]) {
    if (name.trim() === "") continue;
    const at = lower.indexOf(name.toLowerCase());
    if (at >= 0 && (best === null || at < best.at || (at === best.at && name.length > best.length))) best = { entity, at, length: name.length };
  }
  return best;
}

// 要反問時回傳提問的名稱與選項，否則 null。不反問的情況：
// - 問題沒有提到同類型、同顯示名稱的 2 個以上實體（類型不同的同名不算）
// - 問題已含區分的說明（例如「接著問」送出的「林志明（青翼專案）的…」）
// - entityOptionLabel() 分不出來（標籤相同時選了也沒有用）
// 有多組時問最早出現的那一組
export function sameNameAsk(graph: Graph, question: string, language: string): SameNameAsk | null {
  const lower = question.toLowerCase();
  const groups = new Map<string, Hit[]>();
  for (const entity of graph.entities) {
    const hit = hitOf(lower, entity);
    if (hit === null) continue;
    const key = `${entity.type}\u0000${entityName(entity, language)}`;
    groups.set(key, [...(groups.get(key) ?? []), hit]);
  }
  const group = [...groups.values()]
    .filter((hits) => hits.length >= 2)
    .sort((a, b) => Math.min(...a.map((h) => h.at)) - Math.min(...b.map((h) => h.at)))[0];
  if (group === undefined) return null;
  const options = group.map((h) => {
    const label = entityOptionLabel(graph, h.entity, language);
    return { entityId: h.entity.id, label, text: question.slice(0, h.at) + label + question.slice(h.at + h.length) };
  });
  const name = entityName(group[0].entity, language);
  if (new Set(options.map((o) => o.label)).size < options.length) return null;
  if (options.some((o) => o.label !== name && lower.includes(o.label.toLowerCase()))) return null;
  return { name, options };
}
