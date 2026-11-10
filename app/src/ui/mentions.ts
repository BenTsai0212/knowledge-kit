// 「回答提到」的實體與右側實體面板（#195，docs/qa.md「回答提到」）。
// 輸入一律是送出當下身分的 readGraph() 結果（RLS 已篩選）；本模組不另外判斷權限，看不到的實體不會出現在候選中。
import { fill, strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import type { RelationType } from "../client/types";
import type { Graph, GraphEntity } from "../graph/read";
import type { Answer } from "../qa/answer";
import { entityName, entityTypeLabel, relationTypeLabel } from "./graph-labels";

// 每個實體的「接著問」最多幾題（#195 決定 2）
export const MAX_FOLLOW_UPS = 3;

// 名稱在文字中第一次出現的位置（不分大小寫）；主要名稱與各語言的顯示名稱任一出現即可，都沒有時 -1
function firstMention(text: string, entity: GraphEntity): number {
  const positions = [entity.name, ...Object.values(entity.names)]
    .filter((name) => name.trim() !== "")
    .map((name) => text.indexOf(name.toLowerCase()))
    .filter((i) => i >= 0);
  return positions.length === 0 ? -1 : Math.min(...positions);
}

// 回答提到的實體（#195 決定 1）：出處包含回答實際引用的段落，而且名稱出現在回答文字中，兩個條件都要符合。
// 拒答、錯誤與未附出處的回答沒有。依在回答中第一次出現的位置排序
export function mentionedEntities(graph: Graph, answer: Answer): GraphEntity[] {
  if (answer.kind !== "answer" || answer.cited.length === 0) return [];
  const cited = new Set(answer.cited);
  const text = answer.text.toLowerCase();
  return graph.entities
    .filter((e) => e.sources.some((p) => cited.has(p.id)))
    .map((entity) => ({ entity, at: firstMention(text, entity) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.entity);
}

// 以實體為中心的小圖：中心、直接相連的實體與兩者之間的關係（鄰近圖用）
export function neighborhood(graph: Graph, entityId: string): Graph {
  const relations = graph.relations.filter((r) => r.from === entityId || r.to === entityId);
  const ids = new Set([entityId, ...relations.flatMap((r) => [r.from, r.to])]);
  return { entities: graph.entities.filter((e) => ids.has(e.id)), relations };
}

// 「接著問」（#195 決定 2、#198）：關係類型有該方向、介面語言的問句範本（knowledge-model.json 的 questions）時用範本，
// 否則退回翻譯檔的通用範本（關係的名稱加上另一端的實體類型；followUpOutgoing：中心是起點；followUpIncoming：中心是終點）。
// 關係類型、方向與另一端的類型相同的只留一題，產生的問句相同的也只留一題（不含 {type} 的範本），最多 MAX_FOLLOW_UPS 題，依關係 id 的順序
export function followUps(
  graph: Graph,
  entityId: string,
  language: string,
  relationTypes: RelationType[] = clientConfig.knowledgeModel.relationTypes,
): string[] {
  const s = strings(language);
  const center = graph.entities.find((e) => e.id === entityId);
  if (center === undefined) return [];
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const questions: string[] = [];
  for (const r of graph.relations) {
    if (questions.length === MAX_FOLLOW_UPS) break;
    if (r.from !== entityId && r.to !== entityId) continue;
    const outgoing = r.from === entityId;
    const other = byId.get(outgoing ? r.to : r.from);
    const key = `${outgoing}|${r.type}|${other?.type}`;
    if (other === undefined || seen.has(key)) continue;
    seen.add(key);
    const templates = relationTypes.find((t) => t.id === r.type)?.questions;
    const template = (outgoing ? templates?.outgoing : templates?.incoming)?.[language];
    const question = fill(template ?? (outgoing ? s.followUpOutgoing : s.followUpIncoming), {
      name: entityName(center, language),
      relation: relationTypeLabel(r.type, language),
      // 類型放在句中：英文等有大小寫的語言改成小寫（「Which project …」）；中文、日文不受影響
      type: entityTypeLabel(other.type, language).toLocaleLowerCase(language),
    });
    if (!questions.includes(question)) questions.push(question);
  }
  return questions;
}
