// 圖譜的顯示文字：實體名稱依介面語言（names），類型與關係類型的名稱來自 knowledge-model.json。
import { clientConfig } from "../client/load";
import type { Graph, GraphEntity } from "../graph/read";

const { entityTypes, relationTypes } = clientConfig.knowledgeModel;

// names 缺少該語言時（例如之後萃取的實體）退回主要名稱
export const entityName = (entity: Pick<GraphEntity, "name" | "names">, language: string) => entity.names[language] || entity.name;

export const entityTypeLabel = (type: string, language: string) => entityTypes.find((t) => t.id === type)?.label[language] ?? type;

export const relationTypeLabel = (type: string, language: string) => relationTypes.find((t) => t.id === type)?.label[language] ?? type;

export interface RelatedEntity {
  relationId: string;
  // 關係類型的名稱；outgoing 為 false 時方向相反（另一端 → 本實體）
  label: string;
  outgoing: boolean;
  entity: GraphEntity;
}

// 與實體直接相連的實體，依關係 id 排序
export function relatedEntities(graph: Graph, entityId: string, language: string): RelatedEntity[] {
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  return graph.relations
    .filter((r) => r.from === entityId || r.to === entityId)
    .flatMap((r) => {
      const other = byId.get(r.from === entityId ? r.to : r.from);
      return other ? [{ relationId: r.id, label: relationTypeLabel(r.type, language), outgoing: r.from === entityId, entity: other }] : [];
    });
}

// 下拉選單用的名稱：顯示名稱相同的實體（例如兩位林志明）加上第一個相關實體的名稱以便區分
export function entityOptionLabel(graph: Graph, entity: GraphEntity, language: string): string {
  const name = entityName(entity, language);
  const same = graph.entities.filter((e) => entityName(e, language) === name);
  if (same.length < 2) return name;
  const first = relatedEntities(graph, entity.id, language)[0];
  return first ? `${name}（${entityName(first.entity, language)}）` : `${name}（${entity.id}）`;
}
