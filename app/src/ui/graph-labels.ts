// 圖譜的顯示文字：實體名稱依介面語言（names），類型與關係類型的名稱來自 knowledge-model.json。
import { fill, strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import type { Graph, GraphEntity, SourcePassage } from "../graph/read";

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

// 下拉選單用的名稱：顯示名稱相同的實體（例如同名的兩個人）加上第一個相關實體的名稱以便區分
export function entityOptionLabel(graph: Graph, entity: GraphEntity, language: string): string {
  const name = entityName(entity, language);
  const same = graph.entities.filter((e) => entityName(e, language) === name);
  if (same.length < 2) return name;
  const first = relatedEntities(graph, entity.id, language)[0];
  return fill(strings(language).parenthetical, { text: name, note: first ? entityName(first.entity, language) : entity.id });
}

export interface DisplaySource extends SourcePassage {
  // 不是介面語言的出處才有：該段語言的名稱，依介面語言顯示（例如英文介面的 zh-TW → Chinese (Taiwan)）
  languageLabel?: string;
}

// 出處優先顯示介面語言（#36）：有介面語言的出處時只顯示這些；沒有時顯示其他語言並標示語言，不讓關係看起來沒有出處
export function sourcesForLanguage(sources: SourcePassage[], language: string): DisplaySource[] {
  const same = sources.filter((s) => s.language === language);
  if (same.length > 0 || sources.length === 0) return same;
  const names = new Intl.DisplayNames([language], { type: "language" });
  return sources.map((s) => ({ ...s, languageLabel: names.of(s.language) ?? s.language }));
}
