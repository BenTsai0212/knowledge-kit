// 只審接縫（ADR 0011 決定 1、2，docs/extraction.md「直接收錄」）：判斷哪些待審項目是接縫、交給人，其餘直接收錄。
// 純函式。不用數值分數，只用可重現的結構規則與模型標示的原因；visible 一律是上傳者看得到的實體（RLS 已篩選）。
import type { ClientConfig, LanguageCode, LocalizedText } from "../client/types";
import { normalizeName, suggestMerge } from "./merge";

// 模型標示沒把握的原因（萃取 JSON 的 unsure，migration 0013）
export const UNSURE = ["same_name", "possible_typo", "relation_wording", "other"] as const;
export type Unsure = (typeof UNSURE)[number];

// 接縫的原因：合併候選 2 個以上、名稱缺少語言、與看得到的或同一份文件的同類型實體只差一個字、模型標示沒把握、關係的端點是接縫
export type SeamReason = "candidates" | "missing_language" | "near_name" | "unsure" | "endpoint";

export interface SeamEntityInput {
  id: string;
  type: string;
  names: LocalizedText;
  unsure: Unsure | null;
}

export interface SeamRelationInput {
  id: string;
  from: string;
  to: string;
  unsure: Unsure | null;
}

export interface VisibleEntity {
  id: string;
  type: string;
  name: string;
  names: LocalizedText;
}

// 接縫：seams 不是空的。直接收錄：seams 是空的，mergeInto 是唯一的合併候選（沒有候選時建立新實體）
export interface EntityPlan {
  seams: SeamReason[];
  mergeInto?: string;
}

export interface SeamContext {
  entityTypes: ClientConfig["knowledgeModel"]["entityTypes"];
  languages: LanguageCode[];
  documentLanguage: LanguageCode;
}

// 編輯距離（Levenshtein，以 Unicode 字元計）
export function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[y.length];
}

const blank = (name: string | undefined) => name === undefined || name.trim() === "";

const rulesOf = (type: string, ctx: SeamContext) =>
  ctx.entityTypes.find((t) => t.id === type)?.aliasRules ?? { normalizeWidth: false, ignoreCase: false, ignoreWhitespace: false };

// 新實體的文件語言名稱只差一個字（可能是錯字或同一人，例如「張雅亭／張雅婷」），依類型的 aliasRules 正規化後比對：
// - 看得到的同類型實體的任一名稱
// - 同一份文件中其他待審的同類型實體的文件語言名稱（兩個新實體都成立，都是接縫）
// 回傳第一個只差一個字的對象（待審頁的提問寫出它的名稱）；看得到的實體優先。
// 類型的 nearName 是 false 時不比對（#411：部門、專案名稱字少，差一字通常是不同的單位）
export type NearMatch = { kind: "visible"; entity: VisibleEntity } | { kind: "sibling"; entity: SeamEntityInput };

export function nearMatch(entity: SeamEntityInput, visible: VisibleEntity[], siblings: SeamEntityInput[], ctx: SeamContext): NearMatch | null {
  const name = entity.names[ctx.documentLanguage];
  if (blank(name) || ctx.entityTypes.find((t) => t.id === entity.type)?.nearName === false) return null;
  const rules = rulesOf(entity.type, ctx);
  const key = normalizeName(name!, rules);
  const near = (n: string | undefined) => n !== undefined && !blank(n) && editDistance(key, normalizeName(n, rules)) === 1;
  const v = visible.find((x) => x.type === entity.type && [x.name, ...Object.values(x.names)].some(near));
  if (v !== undefined) return { kind: "visible", entity: v };
  const s = siblings.find((x) => x.id !== entity.id && x.type === entity.type && near(x.names[ctx.documentLanguage]));
  return s === undefined ? null : { kind: "sibling", entity: s };
}

// siblings：同一份文件中其他待審的實體（可含 entity 本身，以 id 排除）
export function planEntity(entity: SeamEntityInput, visible: VisibleEntity[], ctx: SeamContext, siblings: SeamEntityInput[] = []): EntityPlan {
  const seams: SeamReason[] = [];
  const merge = suggestMerge(entity, visible, ctx.entityTypes);
  const candidates = merge.mode === "new" ? [] : merge.mode === "auto" ? [merge.target] : merge.candidates;
  if (candidates.length >= 2) seams.push("candidates");
  if (ctx.languages.some((l) => blank(entity.names[l]))) seams.push("missing_language");
  if (candidates.length === 0 && nearMatch(entity, visible, siblings, ctx) !== null) seams.push("near_name");
  if (entity.unsure !== null) seams.push("unsure");
  // 只有一個候選的合併直接收錄（ADR 0011 決定 2），不論 mergeStrategy
  return seams.length === 0 && candidates.length === 1 ? { seams, mergeInto: candidates[0] } : { seams };
}

// 關係：模型標示沒把握，或任一端是接縫（跟著端點留在接縫中）。entitySeams 是同一份文件待審實體的判斷結果；
// 不在其中的端點（已有決定的實體）不算接縫，是否已核准由 store.ts 在寫入前查
export function planRelation(relation: SeamRelationInput, entitySeams: ReadonlyMap<string, EntityPlan>): SeamReason[] {
  const seams: SeamReason[] = [];
  if (relation.unsure !== null) seams.push("unsure");
  if ([relation.from, relation.to].some((id) => (entitySeams.get(id)?.seams.length ?? 0) > 0)) seams.push("endpoint");
  return seams;
}
