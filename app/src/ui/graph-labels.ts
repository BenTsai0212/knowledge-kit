// 圖譜的顯示文字：實體名稱依介面語言（names），類型與關係類型的名稱來自 knowledge-model.json。
import { fill, strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import type { Graph, GraphEntity, SourcePassage } from "../graph/read";
import { highlightSegments, type Segment } from "./review-helpers";

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

export interface RelatedEntityGroup {
  entity: GraphEntity;
  // 兩者之間的每一則關係（依關係 id 排序）
  relations: Omit<RelatedEntity, "entity">[];
}

// 展示模式的實體卡片（#349，畫板 H-Graph）：相關實體每個一列，同一個實體的多則關係合併（依第一次出現的順序）
export function relatedEntityGroups(graph: Graph, entityId: string, language: string): RelatedEntityGroup[] {
  const groups = new Map<string, RelatedEntityGroup>();
  for (const { entity, ...relation } of relatedEntities(graph, entityId, language)) {
    const group = groups.get(entity.id) ?? { entity, relations: [] };
    group.relations.push(relation);
    groups.set(entity.id, group);
  }
  return [...groups.values()];
}

// 合併後的關係名稱（「隸屬 · 負責」）：方向都相同時箭頭只標一次（「← 隸屬 · 負責」），不同時每則各自標示
export function relationGroupLabel(relations: readonly Pick<RelatedEntity, "label" | "outgoing">[]): string {
  const arrow = (r: Pick<RelatedEntity, "label" | "outgoing">) => (r.outgoing ? `${r.label} →` : `← ${r.label}`);
  if (relations.length > 0 && relations.every((r) => r.outgoing === relations[0].outgoing)) {
    return arrow({ label: relations.map((r) => r.label).join(" · "), outgoing: relations[0].outgoing });
  }
  return relations.map(arrow).join(" · ");
}

// 下拉選單用的名稱：顯示名稱相同的實體（例如同名的兩個人）加上第一個相關實體的名稱以便區分
export function entityOptionLabel(graph: Graph, entity: GraphEntity, language: string): string {
  const name = entityName(entity, language);
  const same = graph.entities.filter((e) => entityName(e, language) === name);
  if (same.length < 2) return name;
  const first = relatedEntities(graph, entity.id, language)[0];
  return fill(strings(language).parenthetical, { text: name, note: first ? entityName(first.entity, language) : entity.id });
}

// 圖上節點的標籤（#198）：與搜尋結果相同，同名的實體以 entityOptionLabel() 區分。
// 鄰近圖只畫小圖，同名的另一位可能不在小圖中，所以同名與相關實體以 labelGraph（完整的可見圖）比對
export function nodeLabels(graph: Graph, language: string, labelGraph: Graph = graph): Map<string, string> {
  const byId = new Map(labelGraph.entities.map((e) => [e.id, e]));
  return new Map(graph.entities.map((e) => [e.id, entityOptionLabel(labelGraph, byId.get(e.id) ?? e, language)]));
}

// 量文字寬度（px），例如 canvas 的 measureText
export type MeasureText = (text: string) => number;

const ELLIPSIS = "…";

// 一行放得下的最長開頭（逐字），至少一個字，避免無限迴圈
function fitPrefix(text: string, measure: MeasureText, maxWidth: number, suffix = ""): string {
  const chars = [...text];
  let n = chars.length;
  while (n > 1 && measure(chars.slice(0, n).join("") + suffix) > maxWidth) n--;
  return chars.slice(0, n).join("");
}

// 圖上節點名稱的顯示文字（#288，docs/design.md「英文版面」）：最寬 maxWidth、最多 maxLines 行，超過以「…」截斷。
// 英文在空白處換行，太長的單字與中文逐字換行；行之間以 \n 分隔（cytoscape 的 text-wrap: wrap 照 \n 換行）。
// 只用在畫面上的標籤：完整名稱在選取、滑過（graph-style.ts）與實體面板顯示，搜尋與報讀器用的也是完整名稱
export function clampLabel(text: string, measure: MeasureText, maxWidth: number, maxLines = 2): string {
  const tokens = text.trim().match(/\S+\s*/g) ?? [];
  const lines: string[] = [];
  let line = "";
  const push = () => {
    lines.push(line.trimEnd());
    line = "";
  };
  for (let token of tokens) {
    if (measure((line + token).trimEnd()) <= maxWidth) {
      line += token;
      continue;
    }
    if (line !== "") push();
    // 一個詞放不下一行時逐字切開
    while (measure(token.trimEnd()) > maxWidth) {
      const head = fitPrefix(token, measure, maxWidth);
      line = head;
      push();
      token = token.slice(head.length);
    }
    line = token;
  }
  if (line.trim() !== "") push();
  if (lines.length <= maxLines) return lines.join("\n");
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = measure(last + ELLIPSIS) <= maxWidth ? last + ELLIPSIS : fitPrefix(last, measure, maxWidth, ELLIPSIS).trimEnd() + ELLIPSIS;
  return kept.join("\n");
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

export interface EntityDocument {
  documentId: string;
  documentTitle: string;
  languageLabel?: string;
  // 這份文件中提到實體、目前身分看得到的出處段落（依段落順序）；segments 是標出實體名稱的原文
  passages: { id: string; segments: Segment[] }[];
}

// 實體面板「出現的文件」（#240）：出處依文件分組，每份文件一張 reading 紙面，列出提到實體的原文片段，
// 片段中的實體名稱（主要名稱與各語言的顯示名稱）以 <mark> 標出。段落只來自 readGraph() 的出處，
// 也就是目前身分看得到的段落（withIdentity()／RLS）；文件中看不到的段落不出現，也不標示被省略（#247）
export function entityDocuments(entity: GraphEntity, language: string): EntityDocument[] {
  const names = [entity.name, ...Object.values(entity.names)];
  const byDocument = new Map<string, EntityDocument>();
  for (const p of sourcesForLanguage(entity.sources, language)) {
    const doc = byDocument.get(p.documentId) ?? { documentId: p.documentId, documentTitle: p.documentTitle, languageLabel: p.languageLabel, passages: [] };
    doc.passages.push({ id: p.id, segments: highlightSegments(p.content, names) });
    byDocument.set(p.documentId, doc);
  }
  return [...byDocument.values()];
}
