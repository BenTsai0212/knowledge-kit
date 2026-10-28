// 待審頁的核准計畫（#44）：每筆實體的合併選擇，以及批次核准時要送出的項目。
// 需要選擇合併對象的項目（suggestMerge 的 choose）不能批次核准，只能逐筆決定。
import type { LocalizedText } from "../client/types";
import type { MergeSuggestion } from "../extraction/merge";
import type { EntityApproval, ReviewDocument } from "../extraction/store";

// mergeInto：既有實體的 id；null 表示建立新實體；undefined 表示還沒選擇
export interface EntityChoice {
  mergeInto: string | null | undefined;
  // 核准前修改的名稱（只用於建立新實體）
  names?: LocalizedText;
}

export function initialChoice(suggestion: MergeSuggestion): EntityChoice {
  if (suggestion.mode === "new") return { mergeInto: null };
  if (suggestion.mode === "auto") return { mergeInto: suggestion.target };
  return { mergeInto: undefined };
}

export const canBatch = (suggestion: MergeSuggestion) => suggestion.mode !== "choose";

// 一筆實體的核准內容；還沒選擇合併對象時回 null
export function entityApproval(id: string, choice: EntityChoice): EntityApproval | null {
  if (choice.mergeInto === undefined) return null;
  if (choice.mergeInto !== null) return { id, mergeInto: choice.mergeInto };
  return choice.names ? { id, names: choice.names } : { id };
}

// 批次核准：只包含待審、可以批次核准的實體，以及兩端都已核准或一起核准的待審關係。
// only 有值時只處理其中的項目（勾選的項目）；沒有值時處理整份文件（「核准這份文件的全部」）
export function batchPlan(
  doc: ReviewDocument,
  suggestions: Record<string, MergeSuggestion>,
  choices: Record<string, EntityChoice>,
  only?: ReadonlySet<string>,
): { entities: EntityApproval[]; relations: string[] } {
  const included = (id: string) => only === undefined || only.has(id);
  const entities = doc.entities
    .filter((e) => e.status === "pending" && included(e.id) && canBatch(suggestions[e.id] ?? { mode: "new" }))
    .map((e) => entityApproval(e.id, choices[e.id] ?? { mergeInto: null }))
    .filter((a): a is EntityApproval => a !== null);
  const approving = new Set(entities.map((e) => e.id));
  const approved = (id: string) => approving.has(id) || doc.entities.some((e) => e.id === id && e.status === "approved");
  const relations = doc.relations.filter((r) => r.status === "pending" && included(r.id) && approved(r.from) && approved(r.to)).map((r) => r.id);
  return { entities, relations };
}

// 關係是否能核准：兩端都已核准
export const relationReady = (doc: ReviewDocument, relationId: string) => {
  const r = doc.relations.find((x) => x.id === relationId);
  return r !== undefined && [r.from, r.to].every((id) => doc.entities.some((e) => e.id === id && e.status === "approved"));
};
