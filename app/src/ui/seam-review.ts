// 待審頁的接縫（ADR 0011 決定 1、6、8，docs/design.md「待審的接縫」）：client.json 的 review.mode 為 seams 時，
// 待審的項目中哪些是接縫、要問什麼、給哪些選項。純函式；接縫的規則沿用 seams.ts，依目前身分（審核者）看得到的實體重算，
// 所以提問與選項只用審核者看得到的內容（#247）。不是接縫的待審項目（例如直接收錄失敗）留在 rest，照逐筆核准的畫面處理
import type { ClientConfig, LocalizedText } from "../client/types";
import { suggestMerge } from "../extraction/merge";
import { nearMatch, planEntity, type SeamEntityInput, type Unsure, type VisibleEntity } from "../extraction/seams";
import type { EntityApproval, ReviewDocument, ReviewEntity, ReviewRelation } from "../extraction/store";
import type { Graph } from "../graph/read";
import { existingRelation, groupPlan, namesComplete, relationReady, type EntityChoice } from "./review-helpers";

// 選項對應的決定：合併到既有實體、建立新實體、照系統的判斷收錄（只有一個候選時合併，否則建立新實體）、不收錄
export type SeamOption = { kind: "merge"; target: string } | { kind: "new" } | { kind: "keep" } | { kind: "reject" };

// 提問的種類（一個項目只問一件事，依序：候選 2 個以上、只差一個字、模型標示沒把握、名稱缺少語言）
export type SeamAsk =
  | { kind: "candidates"; candidates: string[] }
  // other：只差一個字的名稱；target：看得到的實體（同一份文件的另一筆待審時為 null，不能合併）
  | { kind: "near"; other: string; target: string | null }
  | { kind: "unsure"; unsure: Unsure }
  | { kind: "missing"; languages: string[] };

export interface EntitySeam {
  entity: ReviewEntity;
  ask: SeamAsk;
  options: SeamOption[];
  // 「照系統的判斷收錄」時的合併對象（只有一個候選時），否則 null
  keepInto: string | null;
  // 掛在這一項底下的待審關係：跟著它一起決定
  relations: ReviewRelation[];
}

export interface RelationSeam {
  relation: ReviewRelation;
  unsure: Unsure;
  options: SeamOption[];
}

export interface SeamPartition {
  entities: EntitySeam[];
  relations: RelationSeam[];
  // 不是接縫的待審項目與已決定的項目（逐筆核准的畫面處理）
  rest: ReviewDocument;
}

type Context = { entityTypes: ClientConfig["knowledgeModel"]["entityTypes"]; languages: string[] };

const input = (e: ReviewEntity): SeamEntityInput => ({ id: e.id, type: e.type, names: e.names, unsure: e.unsure ?? null });

function entityAsk(e: ReviewEntity, visible: VisibleEntity[], siblings: SeamEntityInput[], ctx: Context, language: string): Omit<EntitySeam, "relations"> | null {
  const seamCtx = { entityTypes: ctx.entityTypes, languages: ctx.languages, documentLanguage: language };
  const plan = planEntity(input(e), visible, seamCtx, siblings);
  if (plan.seams.length === 0) return null;
  const merge = suggestMerge(e, visible, ctx.entityTypes);
  const candidates = merge.mode === "new" ? [] : merge.mode === "auto" ? [merge.target] : merge.candidates;
  const keepInto = candidates.length === 1 ? candidates[0] : null;
  const base = { entity: e, keepInto };
  if (plan.seams.includes("candidates")) {
    return { ...base, ask: { kind: "candidates", candidates }, options: [...candidates.map((target) => ({ kind: "merge", target }) as const), { kind: "new" }] };
  }
  if (plan.seams.includes("near_name")) {
    const near = nearMatch(input(e), visible, siblings, seamCtx)!;
    const other = near.kind === "visible" ? near.entity.name : (near.entity.names[language] ?? "");
    return near.kind === "visible"
      ? { ...base, ask: { kind: "near", other, target: near.entity.id }, options: [{ kind: "merge", target: near.entity.id }, { kind: "new" }] }
      : { ...base, ask: { kind: "near", other, target: null }, options: [{ kind: "new" }, { kind: "reject" }] };
  }
  if (e.unsure !== undefined) return { ...base, ask: { kind: "unsure", unsure: e.unsure }, options: [{ kind: "keep" }, { kind: "reject" }] };
  const languages = ctx.languages.filter((l) => (e.names[l] ?? "").trim() === "");
  return { ...base, ask: { kind: "missing", languages }, options: [{ kind: "keep" }, { kind: "reject" }] };
}

// visible：目前身分看得到的實體（readGraph() 的結果）
export function seamPartition(doc: ReviewDocument, visible: VisibleEntity[], ctx: Context): SeamPartition {
  const pending = doc.entities.filter((e) => e.status === "pending");
  const siblings = pending.map(input);
  const entities: EntitySeam[] = [];
  for (const e of pending) {
    const ask = entityAsk(e, visible, siblings, ctx, doc.language);
    if (ask !== null) entities.push({ ...ask, relations: [] });
  }
  const relations: RelationSeam[] = [];
  const attached = new Set<string>();
  for (const r of doc.relations.filter((x) => x.status === "pending")) {
    // 掛在第一個是接縫的端點底下；兩端都不是接縫、模型標示沒把握的關係自己是一個接縫
    const owner = entities.find((x) => x.entity.id === r.from) ?? entities.find((x) => x.entity.id === r.to);
    if (owner !== undefined) owner.relations.push(r);
    else if (r.unsure !== undefined) relations.push({ relation: r, unsure: r.unsure, options: [{ kind: "keep" }, { kind: "reject" }] });
    else continue;
    attached.add(r.id);
  }
  const seamIds = new Set(entities.map((x) => x.entity.id));
  return {
    entities,
    relations,
    rest: { ...doc, entities: doc.entities.filter((e) => !seamIds.has(e.id)), relations: doc.relations.filter((r) => !attached.has(r.id)) },
  };
}

type Plan = { entities: EntityApproval[]; relations: string[]; existingRelations: string[] };

// 選了收錄的選項時要核准的內容：這一項（合併到選的對象、或以 names 建立新實體），加上底下兩端都已核准的關係（groupPlan）。
// 不收錄、或建立新實體但名稱不完整時回 null。names：審核者補上或修改的名稱（只用於建立新實體）
export function seamPlan(
  doc: ReviewDocument,
  seam: EntitySeam,
  option: SeamOption,
  names: LocalizedText | undefined,
  graph: Pick<Graph, "relations">,
  languages: readonly string[],
): Plan | null {
  if (option.kind === "reject") return null;
  const mergeInto = option.kind === "merge" ? option.target : option.kind === "keep" ? seam.keepInto : null;
  if (mergeInto === null && !namesComplete(names ?? seam.entity.names, languages)) return null;
  const choices: Record<string, EntityChoice> = { [seam.entity.id]: { mergeInto, ...(mergeInto === null && names !== undefined && { names }) } };
  const relations = seam.relations.map((relation) => ({ relation, existing: existingRelation(doc, relation, choices, graph) !== undefined }));
  return groupPlan(doc, { entity: seam.entity, kind: "new", relations }, [], {}, choices, languages);
}

// 關係的接縫選了「沒問題」：兩端都已核准時核准（圖譜已有時只寫決定），否則 null
export function relationSeamPlan(doc: ReviewDocument, relation: ReviewRelation, graph: Pick<Graph, "relations">): Plan | null {
  if (!relationReady(doc, relation.id)) return null;
  const existing = existingRelation(doc, relation, {}, graph) !== undefined;
  return { entities: [], relations: existing ? [] : [relation.id], existingRelations: existing ? [relation.id] : [] };
}

// 「已直接收錄」區（ADR 0011 決定 5，docs/design.md「待審的接縫」）：目前有效的決定是直接收錄的項目（可以撤回），
// 以及直接收錄後被撤回的項目（標示「已撤回」；已回到待審或已由人重新決定）。依文件中的順序，實體在前
export type AutoItem = { kind: "entity"; item: ReviewEntity } | { kind: "relation"; item: ReviewRelation };

export function autoItems(doc: ReviewDocument): { active: AutoItem[]; retracted: AutoItem[] } {
  const all: AutoItem[] = [
    ...doc.entities.map((item): AutoItem => ({ kind: "entity", item })),
    ...doc.relations.map((item): AutoItem => ({ kind: "relation", item })),
  ];
  return {
    active: all.filter((x) => x.item.status === "approved" && x.item.mode === "auto"),
    retracted: all.filter((x) => x.item.autoRetracted !== undefined),
  };
}

// 隨機抽查：從 items 中不重複地抽 n 項（不足 n 項時全部），保留原本的順序。random 可注入（測試用）
export function sample<T>(items: readonly T[], n: number, random: () => number = Math.random): T[] {
  const pool = items.map((_, i) => i);
  const count = Math.min(n, items.length);
  for (let k = 0; k < count; k++) {
    const j = k + Math.floor(random() * (pool.length - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  const picked = new Set(pool.slice(0, count));
  return items.filter((_, i) => picked.has(i));
}
