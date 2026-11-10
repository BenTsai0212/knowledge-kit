// 待審頁的核准計畫（#44）：每筆實體的合併選擇，以及批次核准時要送出的項目。
// 有兩個以上候選的項目（suggestMerge 的 choose）不能批次核准，只能逐筆決定；
// 只有一個候選的是系統建議，預先帶入合併對象、可以批次核准（#189 決定，取代 #44 決定中「一個候選也要逐筆選」）。
import type { LocalizedText } from "../client/types";
import type { ConflictItem } from "../conflicts/store";
import type { MergeSuggestion } from "../extraction/merge";
import type { EntityApproval, ReviewDocument, ReviewEntity, ReviewRelation } from "../extraction/store";
import type { Graph, GraphRelation } from "../graph/read";
import type { AnswerReport } from "../reports/store";

// mergeInto：既有實體的 id；null 表示建立新實體；undefined 表示還沒選擇
export interface EntityChoice {
  mergeInto: string | null | undefined;
  // 核准前修改的名稱（只用於建立新實體）
  names?: LocalizedText;
}

// 系統建議：需要確認、但只有一個候選（#189）
export const isSuggested = (suggestion: MergeSuggestion) => suggestion.mode === "choose" && suggestion.candidates.length === 1;

export function initialChoice(suggestion: MergeSuggestion): EntityChoice {
  if (suggestion.mode === "new") return { mergeInto: null };
  if (suggestion.mode === "auto") return { mergeInto: suggestion.target };
  return { mergeInto: isSuggested(suggestion) ? suggestion.candidates[0] : undefined };
}

export const canBatch = (suggestion: MergeSuggestion) => suggestion.mode !== "choose" || isSuggested(suggestion);

// 各語言的名稱去掉前後空白後都有值（#47 審查）
export const namesComplete = (names: LocalizedText, languages: readonly string[]) => languages.every((l) => (names[l] ?? "").trim() !== "");

// 修改後的名稱不完整：建立新實體、而且有修改名稱時才檢查（合併時名稱不使用）
export const namesInvalid = (choice: EntityChoice, languages: readonly string[]) =>
  choice.mergeInto === null && choice.names !== undefined && !namesComplete(choice.names, languages);

// 一筆實體的核准內容；還沒選擇合併對象、或修改後的名稱不完整時回 null。送出的名稱去掉前後空白
export function entityApproval(id: string, choice: EntityChoice, languages: readonly string[]): EntityApproval | null {
  if (choice.mergeInto === undefined || namesInvalid(choice, languages)) return null;
  if (choice.mergeInto !== null) return { id, mergeInto: choice.mergeInto };
  if (choice.names === undefined) return { id };
  return { id, names: Object.fromEntries(languages.map((l) => [l, choice.names![l].trim()])) };
}

// 待審實體核准後的 id：已核准的用核准時的決定，待審的用目前的選擇（建立新實體時沿用待審 id）；還沒選擇或已退回時為 undefined
function resolvedId(doc: ReviewDocument, choices: Record<string, EntityChoice>, id: string): string | undefined {
  const e = doc.entities.find((x) => x.id === id);
  if (e === undefined || e.status === "rejected") return undefined;
  if (e.status === "approved") return e.mergedInto ?? e.id;
  const into = (choices[id] ?? { mergeInto: null }).mergeInto;
  return into === undefined ? undefined : (into ?? id);
}

// 圖譜已有（#189）：依目前的選擇算出兩端，類型與兩端都相同的既有關係（只看核准者看得到的關係）
export function existingRelation(
  doc: ReviewDocument,
  relation: Pick<ReviewRelation, "type" | "from" | "to">,
  choices: Record<string, EntityChoice>,
  graph: Pick<Graph, "relations">,
): GraphRelation | undefined {
  const from = resolvedId(doc, choices, relation.from);
  const to = resolvedId(doc, choices, relation.to);
  if (from === undefined || to === undefined) return undefined;
  return graph.relations.find((r) => r.type === relation.type && r.from === from && r.to === to);
}

// 批次核准：只包含待審、可以批次核准的實體，以及兩端都已核准或一起核准的待審關係。
// 圖譜已有的關係放在 existingRelations：只寫核准決定，不重複建立（#189 決定 1）。
// 名稱不完整的實體略過，回傳略過的筆數（skipped）。
// only 有值時只處理其中的項目；沒有值時處理整份文件（「核准這份文件的全部」）
export function batchPlan(
  doc: ReviewDocument,
  suggestions: Record<string, MergeSuggestion>,
  choices: Record<string, EntityChoice>,
  languages: readonly string[],
  graph: Pick<Graph, "relations">,
  only?: ReadonlySet<string>,
): { entities: EntityApproval[]; relations: string[]; existingRelations: string[]; skipped: number } {
  const included = (id: string) => only === undefined || only.has(id);
  const candidates = doc.entities.filter((e) => e.status === "pending" && included(e.id) && canBatch(suggestions[e.id] ?? { mode: "new" }));
  const skipped = candidates.filter((e) => namesInvalid(choices[e.id] ?? { mergeInto: null }, languages)).length;
  const entities = candidates
    .map((e) => entityApproval(e.id, choices[e.id] ?? { mergeInto: null }, languages))
    .filter((a): a is EntityApproval => a !== null);
  const approving = new Set(entities.map((e) => e.id));
  const approved = (id: string) => approving.has(id) || doc.entities.some((e) => e.id === id && e.status === "approved");
  const ready = doc.relations.filter((r) => r.status === "pending" && included(r.id) && approved(r.from) && approved(r.to));
  const existing = (r: ReviewRelation) => existingRelation(doc, r, choices, graph) !== undefined;
  return {
    entities,
    relations: ready.filter((r) => !existing(r)).map((r) => r.id),
    existingRelations: ready.filter(existing).map((r) => r.id),
    skipped,
  };
}

export interface GroupRelation {
  relation: ReviewRelation;
  // 圖譜已有：核准時只寫決定，不重複建立
  existing: boolean;
}

// 放在最上面、需要人確認的一組：一個待審實體，加上掛在它底下的待審關係（#189）
export interface ReviewGroup {
  entity: ReviewEntity;
  // decide：兩個以上候選，需要選擇合併對象；new：建立新實體（名稱由模型寫，給人看一眼）
  kind: "decide" | "new";
  // 目前還不能核准的原因：還沒選擇合併對象、名稱不完整
  blocked?: "choose" | "names";
  relations: GroupRelation[];
}

export interface ReviewGroups {
  groups: ReviewGroup[];
  // 系統已準備：系統建議與 auto 的合併，以及兩端都不在 groups 的關係（含圖譜已有）
  prepared: { entities: ReviewEntity[]; relations: GroupRelation[] };
  summary: {
    // 核准後新增的實體與關係
    newEntities: number;
    newRelations: number;
    // 合併到既有實體的實體、圖譜已有的關係
    mergedEntities: number;
    existingRelations: number;
    // 還有幾組需要你確認：需要決定的組＋新增的組（#189 決定 2）
    toConfirm: number;
  };
}

// 待審頁的分組（#189）：分在哪一區依合併建議決定，不隨選擇改變（改選擇時項目不會跳到別的區）；
// 不能核准的原因、圖譜已有與摘要依目前的選擇計算
export function reviewGroups(
  doc: ReviewDocument,
  suggestions: Record<string, MergeSuggestion>,
  choices: Record<string, EntityChoice>,
  graph: Pick<Graph, "relations">,
  languages: readonly string[],
): ReviewGroups {
  const choiceOf = (id: string) => choices[id] ?? initialChoice(suggestions[id] ?? { mode: "new" });
  const pendingEntities = doc.entities.filter((e) => e.status === "pending");
  const groups: ReviewGroup[] = [];
  const prepared: ReviewGroups["prepared"] = { entities: [], relations: [] };
  for (const entity of pendingEntities) {
    const suggestion = suggestions[entity.id] ?? { mode: "new" };
    if (suggestion.mode !== "new" && canBatch(suggestion)) {
      prepared.entities.push(entity);
      continue;
    }
    const choice = choiceOf(entity.id);
    const blocked = choice.mergeInto === undefined ? "choose" : namesInvalid(choice, languages) ? "names" : undefined;
    groups.push({ entity, kind: suggestion.mode === "new" ? "new" : "decide", ...(blocked && { blocked }), relations: [] });
  }
  const pendingRelations = doc.relations.filter((r) => r.status === "pending");
  let existingCount = 0;
  for (const relation of pendingRelations) {
    const existing = existingRelation(doc, relation, choices, graph) !== undefined;
    if (existing) existingCount++;
    // 掛在第一個屬於 groups 的端點底下
    const owner = groups.find((g) => g.entity.id === relation.from) ?? groups.find((g) => g.entity.id === relation.to);
    (owner?.relations ?? prepared.relations).push({ relation, existing });
  }
  const into = pendingEntities.map((e) => choiceOf(e.id).mergeInto);
  return {
    groups,
    prepared,
    summary: {
      newEntities: into.filter((m) => m === null).length,
      mergedEntities: into.filter((m) => typeof m === "string").length,
      newRelations: pendingRelations.length - existingCount,
      existingRelations: existingCount,
      toConfirm: groups.length,
    },
  };
}

// 確認一組時，關係的一端可以怎麼核准：這組的實體或已核准（"ready"）；系統已準備、待審、可以批次核准且名稱完整的實體，
// 以目前的選擇一起核准（#189 修正要求）；其他（屬於其他需要確認的組、還沒選擇合併對象）為 null
function groupEnd(
  doc: ReviewDocument,
  group: ReviewGroup,
  prepared: readonly ReviewEntity[],
  suggestions: Record<string, MergeSuggestion>,
  choices: Record<string, EntityChoice>,
  languages: readonly string[],
  id: string,
): "ready" | EntityApproval | null {
  if (id === group.entity.id || doc.entities.some((e) => e.id === id && e.status === "approved")) return "ready";
  if (!prepared.some((e) => e.id === id && e.status === "pending") || !canBatch(suggestions[id] ?? { mode: "new" })) return null;
  return entityApproval(id, choices[id] ?? { mergeInto: null }, languages);
}

// 組裡不能隨這組一起核准的關係：另一端屬於其他需要確認的組、還沒選擇合併對象或名稱不完整（畫面標示「兩端的實體核准後才能核准」）
export function waitingRelations(
  doc: ReviewDocument,
  group: ReviewGroup,
  prepared: readonly ReviewEntity[],
  suggestions: Record<string, MergeSuggestion>,
  choices: Record<string, EntityChoice>,
  languages: readonly string[],
): Set<string> {
  const end = (id: string) => groupEnd(doc, group, prepared, suggestions, choices, languages, id);
  return new Set(group.relations.filter((g) => end(g.relation.from) === null || end(g.relation.to) === null).map((g) => g.relation.id));
}

// 確認一組（#189）：這組的實體，加上它底下的關係；關係的另一端是系統已準備的實體時一起核准（groupEnd）。
// 需要逐筆選擇的實體也可以，選擇後才能確認；還沒選擇合併對象或名稱不完整時回 null。不能一起核准的關係留在組裡（waitingRelations）
export function groupPlan(
  doc: ReviewDocument,
  group: ReviewGroup,
  prepared: readonly ReviewEntity[],
  suggestions: Record<string, MergeSuggestion>,
  choices: Record<string, EntityChoice>,
  languages: readonly string[],
): { entities: EntityApproval[]; relations: string[]; existingRelations: string[] } | null {
  const entity = entityApproval(group.entity.id, choices[group.entity.id] ?? { mergeInto: null }, languages);
  if (entity === null) return null;
  const waiting = waitingRelations(doc, group, prepared, suggestions, choices, languages);
  const ready = group.relations.filter((g) => !waiting.has(g.relation.id));
  const entities = new Map([[entity.id, entity]]);
  for (const { relation } of ready) {
    for (const id of [relation.from, relation.to]) {
      const end = groupEnd(doc, group, prepared, suggestions, choices, languages, id);
      if (end !== null && end !== "ready" && !entities.has(id)) entities.set(id, end);
    }
  }
  return {
    entities: [...entities.values()],
    relations: ready.filter((g) => !g.existing).map((g) => g.relation.id),
    existingRelations: ready.filter((g) => g.existing).map((g) => g.relation.id),
  };
}

// 關係是否能核准：兩端都已核准
export const relationReady = (doc: ReviewDocument, relationId: string) => {
  const r = doc.relations.find((x) => x.id === relationId);
  return r !== undefined && [r.from, r.to].every((id) => doc.entities.some((e) => e.id === id && e.status === "approved"));
};

// 待審筆數（#48）：目前身分看得到的待審實體與關係，加上待處理的說法不同（#51）與未處理的回答錯誤回報（#209）
export const pendingCount = (
  docs: readonly ReviewDocument[],
  conflicts: readonly Pick<ConflictItem, "decision">[] = [],
  reports: readonly Pick<AnswerReport, "resolution">[] = [],
) =>
  docs.reduce((n, d) => n + [...d.entities, ...d.relations].filter((x) => x.status === "pending").length, 0) +
  conflicts.filter((c) => c.decision === null).length +
  reports.filter((r) => r.resolution === null).length;

// 待審頁的文件清單（#51）：待審的文件，加上只有說法不同、沒有待審實體與關係的文件（以新段落的文件資訊補上）
export function reviewDocuments(docs: readonly ReviewDocument[], conflicts: readonly ConflictItem[]): ReviewDocument[] {
  const out = [...docs];
  for (const c of conflicts) {
    if (out.some((d) => d.id === c.documentId)) continue;
    const p = c.newPassage;
    out.push({ id: c.documentId, title: p.documentTitle, language: p.language, visibility: p.visibility, project: p.project, entities: [], relations: [] });
  }
  return out;
}

// 名稱輸入框的寬度（size，以半形字元計）：隨內容調整，全形字元算 2 個，不截斷長名稱（#48）
export const inputSize = (text: string) => Math.max(8, [...text].reduce((n, c) => n + (c.codePointAt(0)! >= 0x2e80 ? 2 : 1), 0) + 2);

export interface Segment {
  text: string;
  mark: boolean;
}

// 出處段落中標出實體名稱（#48）：依序找出最早出現的名稱（同一位置取最長的），不分大小寫；
// 回傳文字片段，由畫面一律以文字節點與 <mark> 組成（比照 SourcePanel）
export function highlightSegments(text: string, terms: readonly string[]): Segment[] {
  const lower = text.toLowerCase();
  const needles = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t !== ""))];
  const segments: Segment[] = [];
  const push = (part: string, mark: boolean) => part !== "" && segments.push({ text: part, mark });
  let pos = 0;
  for (;;) {
    let start = -1;
    let length = 0;
    for (const n of needles) {
      const i = lower.indexOf(n, pos);
      if (i !== -1 && (start === -1 || i < start || (i === start && n.length > length))) {
        start = i;
        length = n.length;
      }
    }
    if (start === -1) break;
    push(text.slice(pos, start), false);
    push(text.slice(start, start + length), true);
    pos = start + length;
  }
  push(text.slice(pos), false);
  return segments;
}

// 核准或退回後短提示的文字（#48 審查第 2 次）：只有一筆時顯示項目名稱（例如「已核准：鄭書豪」），
// 多筆時顯示筆數（「已核准 N 筆」）。名稱以函式替換，不解讀 $& 這類替換字元；畫面以文字節點顯示
export function toastText(templates: { one: string; many: string }, labels: readonly string[]): string {
  if (labels.length === 1) return templates.one.replace("{name}", () => labels[0]);
  return templates.many.replace("{count}", () => String(labels.length));
}
