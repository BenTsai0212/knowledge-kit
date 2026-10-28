// docs/data-model.md「權限規則」的獨立實作（不經過 SQL），用來算出每個身分「應該看得到」的列。
import type { AccessFile } from "../../src/client/types";
import type { Sample } from "./sample";

export type Visible = Record<string, string[]>;

export function expectedVisible(access: AccessFile, data: Sample, identityId: string | null): Visible {
  const role = access.roles.find((r) => r.id === identityId);
  const empty = Object.fromEntries(TABLE_KEYS.map((t) => [t, [] as string[]]));
  if (!role) return empty;

  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
  const canSee = (level: string, project: string | null) =>
    rank.get(level)! <= rank.get(role.visibility)! && (project === null || role.projects.includes(project));

  const docs = new Set(data.docs.filter((d) => canSee(d.level, d.project)).map((d) => d.id));
  const passages = new Set(data.passages.filter((p) => canSee(p.level, p.project) && docs.has(p.doc)).map((p) => p.id));
  const entities = new Set(data.entities.filter((e) => e.sources.some((s) => passages.has(s))).map((e) => e.id));
  const endpointsVisible = (r: Sample["relations"][number]) => entities.has(r.from) && entities.has(r.to);
  const relations = data.relations.filter((r) => r.sources.some((s) => passages.has(s)) && endpointsVisible(r));

  return {
    visibility_levels: access.visibilityLevels.map((l) => l.id),
    projects: access.projects.map((p) => p.id),
    identities: [role.id],
    identity_projects: role.projects.map((p) => `${role.id}|${p}`),
    documents: [...docs],
    passages: [...passages],
    entities: [...entities],
    entity_sources: data.entities.flatMap((e) => e.sources.filter((s) => passages.has(s)).map((s) => `${e.id}|${s}`)),
    relations: relations.map((r) => r.id),
    relation_sources: data.relations
      .filter(endpointsVisible)
      .flatMap((r) => r.sources.filter((s) => passages.has(s)).map((s) => `${r.id}|${s}`)),
  };
}

// 每張表用來比對的鍵（SQL 端以相同的欄位組出字串）
export const TABLE_KEYS = [
  "visibility_levels",
  "projects",
  "identities",
  "identity_projects",
  "documents",
  "passages",
  "entities",
  "entity_sources",
  "relations",
  "relation_sources",
] as const;

export const KEY_SQL: Record<(typeof TABLE_KEYS)[number], string> = {
  visibility_levels: "id",
  projects: "id",
  identities: "id",
  identity_projects: "identity_id || '|' || project_id",
  documents: "id",
  passages: "id",
  entities: "id",
  entity_sources: "entity_id || '|' || passage_id",
  relations: "id",
  relation_sources: "relation_id || '|' || passage_id",
};

// docs/data-model.md「寫入規則」的獨立實作：身分能否上傳某個可見等級與專案的文件（#38）。
// 段落另外要求：文件由同一身分上傳，等級與專案與文件相同（由 app/tests/upload/ 直接測試）
export function canWrite(access: AccessFile, identityId: string | null, level: string, project: string | null): boolean {
  const role = access.roles.find((r) => r.id === identityId);
  if (!role || !role.canUpload) return false;
  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
  return rank.get(level)! <= rank.get(role.visibility)! && (project === null || role.projects.includes(project));
}

// docs/data-model.md「待審與核准」的獨立實作（#44）。待審項目只存在於上傳的文件中
export interface ReviewSample {
  pendingEntities: { id: string; doc: string; type: string; sources: string[] }[];
  pendingRelations: { id: string; doc: string; from: string; to: string; sources: string[] }[];
  decisions: { item: string; decision: "approve" | "reject"; mergeInto?: string }[];
}

// 每張待審資料表看得到的列：有 canReview，且文件看得到（決定：項目看得到）
export function expectedReviewVisible(access: AccessFile, data: Sample, review: ReviewSample, identityId: string | null): Visible {
  const role = access.roles.find((r) => r.id === identityId);
  const docs = new Set(role?.canReview ? expectedVisible(access, data, identityId).documents : []);
  const entities = review.pendingEntities.filter((e) => docs.has(e.doc));
  const relations = review.pendingRelations.filter((r) => docs.has(r.doc));
  const items = new Set([...entities, ...relations].map((x) => x.id));
  return {
    pending_entities: entities.map((e) => e.id),
    pending_entity_sources: entities.flatMap((e) => e.sources.map((s) => `${e.id}|${s}`)),
    pending_relations: relations.map((r) => r.id),
    pending_relation_sources: relations.flatMap((r) => r.sources.map((s) => `${r.id}|${s}`)),
    review_decisions: review.decisions.filter((d) => items.has(d.item)).map((d) => d.item),
  };
}

export const REVIEW_KEY_SQL: Record<string, string> = {
  pending_entities: "id",
  pending_entity_sources: "pending_entity_id || '|' || passage_id",
  pending_relations: "id",
  pending_relation_sources: "pending_relation_id || '|' || passage_id",
  review_decisions: "item_id",
};

// 核准後的正式資料：新實體沿用待審 id；合併時出處加到既有實體；關係的兩端解析成核准後的實體
export function approvedSample(data: Sample, review: ReviewSample): Sample {
  const decision = new Map(review.decisions.map((d) => [d.item, d]));
  const approved = (id: string) => decision.get(id)?.decision === "approve";
  const resolve = (id: string) => decision.get(id)?.mergeInto ?? id;
  const entities = data.entities.map((e) => ({ ...e, sources: [...e.sources] }));
  for (const p of review.pendingEntities.filter((e) => approved(e.id))) {
    const target = decision.get(p.id)!.mergeInto;
    if (target === undefined) entities.push({ id: p.id, sources: [...p.sources] });
    else entities.find((e) => e.id === target)!.sources.push(...p.sources);
  }
  const relations = [
    ...data.relations,
    ...review.pendingRelations.filter((r) => approved(r.id)).map((r) => ({ id: r.id, from: resolve(r.from), to: resolve(r.to), sources: r.sources })),
  ];
  return { ...data, entities, relations };
}

// 能否寫入決定：有 canReview、項目看得到；合併對象是該角色看得到的實體；核准關係時兩端都已核准
export function canDecide(
  access: AccessFile,
  data: Sample,
  review: ReviewSample,
  identityId: string | null,
  item: string,
  decision: { decision: "approve" | "reject"; mergeInto?: string },
): boolean {
  const visible = expectedReviewVisible(access, data, review, identityId);
  if (![...visible.pending_entities, ...visible.pending_relations].includes(item)) return false;
  if (decision.mergeInto !== undefined && !expectedVisible(access, approvedSample(data, review), identityId).entities.includes(decision.mergeInto)) return false;
  const relation = review.pendingRelations.find((r) => r.id === item);
  if (relation && decision.decision === "approve") {
    const approved = (id: string) => review.decisions.some((d) => d.item === id && d.decision === "approve");
    return approved(relation.from) && approved(relation.to);
  }
  return true;
}
