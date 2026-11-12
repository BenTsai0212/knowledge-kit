// 查不到時的下一步（#192、#285，docs/qa.md「拒答」）：拒答下方的「可以試試」清單。
// 依據只有問題文字、目前身分的上傳能力，與送出當下身分的 readGraph() 結果（RLS 已篩選）；不讀檢索結果或拒答原因，
// 所以同一身分問同一題時，「資料沒寫」與「沒有權限」的清單永遠相同，看不到的實體也不會出現（#247）
import { clientConfig } from "../client/load";
import type { RelationType } from "../client/types";
import type { Graph, GraphEntity } from "../graph/read";
import { relationTypeLabel } from "./graph-labels";
import { firstMention, followUps } from "./mentions";

// 問題中沒有看得到的實體時的通用建議
export type RefusalStep = "rephrase" | "askPerson" | "upload";

export type RefusalSuggestion =
  | { kind: "step"; step: RefusalStep }
  // 在圖譜看它
  | { kind: "graph"; entity: GraphEntity }
  // 問它的負責人：role 是 knowledge-model.json 的 owner（介面語言），缺時用關係的名稱
  | { kind: "owner"; entity: GraphEntity; owner: GraphEntity; role: string }
  // 用它換個問法：question 是「接著問」的第一題，沒有時為 null
  | { kind: "rephrase"; entity: GraphEntity; question: string | null };

// 最多以問題中的幾個實體產生建議
export const MAX_REFUSAL_ENTITIES = 2;

// 問題中提到的實體（只從 graph 中找）：依第一次出現的位置排序，同一位置時名稱長的在前；最多 MAX_REFUSAL_ENTITIES 個
export function questionEntities(graph: Graph, question: string): GraphEntity[] {
  const text = question.toLowerCase();
  return graph.entities
    .map((entity) => ({ entity, at: firstMention(text, entity) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at || b.entity.name.length - a.entity.name.length)
    .slice(0, MAX_REFUSAL_ENTITIES)
    .map((x) => x.entity);
}

// 實體的負責人：終點是該實體、關係類型有 owner 的第一個關係的起點
function ownerOf(graph: Graph, entity: GraphEntity, language: string, relationTypes: RelationType[]): { owner: GraphEntity; role: string } | null {
  for (const r of graph.relations) {
    if (r.to !== entity.id || r.from === entity.id) continue;
    const type = relationTypes.find((t) => t.id === r.type);
    const owner = graph.entities.find((e) => e.id === r.from);
    if (type?.owner === undefined || owner === undefined) continue;
    return { owner, role: type.owner[language] || relationTypeLabel(r.type, language) };
  }
  return null;
}

export function refusalNextSteps({
  canUpload,
  graph,
  question,
  language,
  relationTypes = clientConfig.knowledgeModel.relationTypes,
}: {
  canUpload: boolean;
  // 送出當下身分的圖譜；讀取失敗或沒有資料庫時省略，只給通用建議
  graph?: Graph;
  question?: string;
  language?: string;
  relationTypes?: RelationType[];
}): RefusalSuggestion[] {
  const upload: RefusalSuggestion[] = canUpload ? [{ kind: "step", step: "upload" }] : [];
  if (graph === undefined || question === undefined || language === undefined) return generic(upload);
  const entities = questionEntities(graph, question);
  if (entities.length === 0) return generic(upload);
  const suggestions: RefusalSuggestion[] = [];
  for (const entity of entities) {
    suggestions.push({ kind: "graph", entity });
    const owner = ownerOf(graph, entity, language, relationTypes);
    // 同一位負責人只列一次
    if (owner !== null && !suggestions.some((x) => x.kind === "owner" && x.owner.id === owner.owner.id)) suggestions.push({ kind: "owner", entity, ...owner });
  }
  suggestions.push({ kind: "rephrase", entity: entities[0], question: followUps(graph, entities[0].id, language, relationTypes)[0] ?? null });
  return [...suggestions, ...upload];
}

function generic(upload: RefusalSuggestion[]): RefusalSuggestion[] {
  return [{ kind: "step", step: "rephrase" }, { kind: "step", step: "askPerson" }, ...upload];
}
