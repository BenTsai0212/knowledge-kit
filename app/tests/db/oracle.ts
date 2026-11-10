// 權限規則的 oracle：可見範圍的計算（expectedVisible）在 app/src/evals/oracle.ts（#62 決定 B），這裡重新匯出；
// 其餘是只有測試用到的規則（寫入、待審、說法不同）與比對 SQL 的鍵。
import type { AccessFile } from "../../src/client/types";
import { expectedVisible, TABLE_KEYS, type Visible } from "../../src/evals/oracle";
import type { Sample } from "./sample";

export { expectedVisible, TABLE_KEYS, type Visible };

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

// docs/data-model.md「待審與核准」的獨立實作（#44）。待審項目只存在於上傳的文件中。
// decisions 依寫入順序列出；撤回（ADR 0007）以決定的 id 列在 retractions（含連帶撤回）
export interface ReviewSample {
  pendingEntities: { id: string; doc: string; type: string; sources: string[] }[];
  pendingRelations: { id: string; doc: string; from: string; to: string; sources: string[] }[];
  decisions: { item: string; decision: "approve" | "reject"; mergeInto?: string }[];
  retractions: string[];
}

type Decision = ReviewSample["decisions"][number] & { id: string };

// 決定的 id：同一個項目的第 1 筆等於項目 id，第 n 筆是 <項目 id>~<n>
export function decisionsWithId(review: ReviewSample): Decision[] {
  const count = new Map<string, number>();
  return review.decisions.map((d) => {
    const n = (count.get(d.item) ?? 0) + 1;
    count.set(d.item, n);
    return { ...d, id: n === 1 ? d.item : `${d.item}~${n}` };
  });
}

// 每個項目目前有效（未撤回）的決定
function activeDecisions(review: ReviewSample): Map<string, Decision> {
  const retracted = new Set(review.retractions);
  return new Map(decisionsWithId(review).filter((d) => !retracted.has(d.id)).map((d) => [d.item, d]));
}

// 每張待審資料表看得到的列：有 canReview，且文件看得到（決定：項目看得到）。
// 撤回紀錄：項目所屬的文件看得到即可，不要求 canReview（ADR 0007 決定 6）
export function expectedReviewVisible(access: AccessFile, data: Sample, review: ReviewSample, identityId: string | null): Visible {
  const role = access.roles.find((r) => r.id === identityId);
  const visibleDocs = new Set(expectedVisible(access, data, identityId).documents);
  const docs = new Set(role?.canReview ? visibleDocs : []);
  const entities = review.pendingEntities.filter((e) => docs.has(e.doc));
  const relations = review.pendingRelations.filter((r) => docs.has(r.doc));
  const items = new Set([...entities, ...relations].map((x) => x.id));
  const docOf = new Map([...review.pendingEntities, ...review.pendingRelations].map((x) => [x.id, x.doc]));
  const decisions = decisionsWithId(review);
  return {
    pending_entities: entities.map((e) => e.id),
    pending_entity_sources: entities.flatMap((e) => e.sources.map((s) => `${e.id}|${s}`)),
    pending_relations: relations.map((r) => r.id),
    pending_relation_sources: relations.flatMap((r) => r.sources.map((s) => `${r.id}|${s}`)),
    review_decisions: decisions.filter((d) => items.has(d.item)).map((d) => d.id),
    review_retractions: decisions.filter((d) => review.retractions.includes(d.id) && visibleDocs.has(docOf.get(d.item)!)).map((d) => d.id),
  };
}

export const REVIEW_KEY_SQL: Record<string, string> = {
  pending_entities: "id",
  pending_entity_sources: "pending_entity_id || '|' || passage_id",
  pending_relations: "id",
  pending_relation_sources: "pending_relation_id || '|' || passage_id",
  review_decisions: "id",
  review_retractions: "decision_id",
};

// 核准後的正式資料（只看有效的決定，已撤回的不算）：新實體與關係的 id 是決定的 id；
// 合併時出處加到既有實體；關係的兩端解析成兩端目前有效的核准對應的實體
export function approvedSample(data: Sample, review: ReviewSample): Sample {
  const active = activeDecisions(review);
  const approved = (id: string) => active.get(id)?.decision === "approve";
  const resolve = (id: string) => active.get(id)!.mergeInto ?? active.get(id)!.id;
  const entities = data.entities.map((e) => ({ ...e, sources: [...e.sources] }));
  // 新建的實體在撤回後仍然存在（沒有出處），可以是之後合併的對象
  const pending = new Map(review.pendingEntities.map((p) => [p.id, p]));
  for (const d of decisionsWithId(review).filter((d) => pending.has(d.item) && d.decision === "approve" && d.mergeInto === undefined)) {
    entities.push({ id: d.id, sources: active.get(d.item)?.id === d.id ? [...pending.get(d.item)!.sources] : [] });
  }
  for (const p of review.pendingEntities.filter((e) => approved(e.id) && active.get(e.id)!.mergeInto !== undefined)) {
    entities.find((e) => e.id === active.get(p.id)!.mergeInto)!.sources.push(...p.sources);
  }
  const relations = [
    ...data.relations,
    ...review.pendingRelations
      .filter((r) => approved(r.id))
      .map((r) => ({ id: active.get(r.id)!.id, from: resolve(r.from), to: resolve(r.to), sources: r.sources })),
  ];
  return { ...data, entities, relations };
}

// 能否撤回：有 canReview、決定看得到（項目所屬的文件看得到），且還沒有撤回。參考情境與資料集的內容沒有決定，所以撤回不了
export function canRetract(access: AccessFile, data: Sample, review: ReviewSample, identityId: string | null, decisionId: string): boolean {
  return (
    expectedReviewVisible(access, data, review, identityId).review_decisions.includes(decisionId) && !review.retractions.includes(decisionId)
  );
}

// 能否寫入決定：有 canReview、項目看得到、沒有有效的決定；合併對象是該角色看得到的實體；核准關係時兩端都已核准
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
  if (activeDecisions(review).has(item)) return false;
  const relation = review.pendingRelations.find((r) => r.id === item);
  if (relation && decision.decision === "approve") {
    const approved = (id: string) => activeDecisions(review).get(id)?.decision === "approve";
    return approved(relation.from) && approved(relation.to);
  }
  return true;
}

// docs/data-model.md「說法不同」的獨立實作（#51）。新段落只存在於上傳的文件中
export interface ConflictSample {
  // 上傳的文件 → 上傳者
  uploads: Record<string, string>;
  conflicts: { id: string; doc: string; newPassage: string; oldPassage: string }[];
  decisions: { conflict: string; decision: "coexist" | "supersede" | "not_conflict" }[];
}

const SHOWN_TO_ALL = ["coexist", "supersede"];

// 看得到的偵測結果與決定：兩段都看得到，且（有 canReview，或決定是「並存」「取代」）
export function expectedConflictVisible(access: AccessFile, data: Sample, conflicts: ConflictSample, identityId: string | null): Visible {
  const role = access.roles.find((r) => r.id === identityId);
  const passages = new Set(expectedVisible(access, data, identityId).passages);
  const decision = new Map(conflicts.decisions.map((d) => [d.conflict, d.decision]));
  const visible = (c: ConflictSample["conflicts"][number]) => {
    const d = decision.get(c.id);
    return passages.has(c.newPassage) && passages.has(c.oldPassage) && (role?.canReview === true || (d !== undefined && SHOWN_TO_ALL.includes(d)));
  };
  const ids = new Set(conflicts.conflicts.filter(visible).map((c) => c.id));
  return {
    conflicts: [...ids],
    conflict_decisions: conflicts.decisions.filter((d) => ids.has(d.conflict)).map((d) => d.conflict),
  };
}

export const CONFLICT_KEY_SQL: Record<string, string> = {
  conflicts: "id",
  conflict_decisions: "conflict_id",
};

// 能否處理：有 canReview、該組看得到、還沒有決定
export function canDecideConflict(access: AccessFile, data: Sample, conflicts: ConflictSample, identityId: string | null, conflict: string): boolean {
  const role = access.roles.find((r) => r.id === identityId);
  return (
    role?.canReview === true &&
    expectedConflictVisible(access, data, conflicts, identityId).conflicts.includes(conflict) &&
    !conflicts.decisions.some((d) => d.conflict === conflict)
  );
}

// 能否寫入偵測結果：有 canUpload、文件由自己上傳、新段落屬於該文件、既有段落自己看得到而且不在該文件中
export function canWriteConflict(
  access: AccessFile,
  data: Sample,
  conflicts: ConflictSample,
  identityId: string | null,
  pair: { doc: string; newPassage: string; oldPassage: string },
): boolean {
  const role = access.roles.find((r) => r.id === identityId);
  if (!role?.canUpload || conflicts.uploads[pair.doc] !== role.id) return false;
  const docOf = (id: string) => data.passages.find((p) => p.id === id)?.doc;
  return (
    docOf(pair.newPassage) === pair.doc &&
    docOf(pair.oldPassage) !== pair.doc &&
    expectedVisible(access, data, identityId).passages.includes(pair.oldPassage)
  );
}

// 問答的「取代」（docs/conflicts.md「問答的取代」）：舊段落 → 取代它的新段落。
// 只取目前身分看得到的「取代」決定（兩段都看得到）；同一段被多段取代時，取文件日期最新的，日期相同時取 id 較小的。
// dates 是新段落所屬文件的日期（沒有日期時視為最舊）
export function expectedSupersede(
  access: AccessFile,
  data: Sample,
  conflicts: ConflictSample,
  identityId: string | null,
  dates: Record<string, string | null>,
): Map<string, string> {
  const visible = new Set(expectedConflictVisible(access, data, conflicts, identityId).conflicts);
  const supersede = new Set(conflicts.decisions.filter((d) => d.decision === "supersede").map((d) => d.conflict));
  const docOf = (id: string) => data.passages.find((p) => p.id === id)!.doc;
  const newer = (a: string, b: string) => {
    const da = dates[docOf(a)] ?? "";
    const db = dates[docOf(b)] ?? "";
    return da !== db ? da > db : a < b;
  };
  const out = new Map<string, string>();
  for (const c of conflicts.conflicts.filter((c) => visible.has(c.id) && supersede.has(c.id))) {
    const current = out.get(c.oldPassage);
    if (current === undefined || newer(c.newPassage, current)) out.set(c.oldPassage, c.newPassage);
  }
  return out;
}

// 時間軸與原文面板的標示（docs/conflicts.md「畫面」）：段落 id → 「種類|另一段」。
// 看得到的「並存」兩段互相標示；「取代」的舊段落只標示 expectedSupersede() 的取代者，新段落標示每一段被它取代的舊段落
export function expectedMarks(
  access: AccessFile,
  data: Sample,
  conflicts: ConflictSample,
  identityId: string | null,
  dates: Record<string, string | null>,
): Map<string, string[]> {
  const visible = new Set(expectedConflictVisible(access, data, conflicts, identityId).conflicts);
  const decision = new Map(conflicts.decisions.map((d) => [d.conflict, d.decision]));
  const out = new Map<string, string[]>();
  const add = (id: string, mark: string) => out.set(id, [...(out.get(id) ?? []), mark].sort());
  for (const c of conflicts.conflicts.filter((c) => visible.has(c.id))) {
    if (decision.get(c.id) === "coexist") {
      add(c.oldPassage, `conflict|${c.newPassage}`);
      add(c.newPassage, `conflict|${c.oldPassage}`);
    } else if (decision.get(c.id) === "supersede") add(c.newPassage, `supersedes|${c.oldPassage}`);
  }
  for (const [old, by] of expectedSupersede(access, data, conflicts, identityId, dates)) add(old, `superseded_by|${by}`);
  return out;
}

// docs/data-model.md「回答錯誤回報」的獨立實作（ADR 0007 決定 7）。拒答的回報沒有段落（sent 是空的）
export interface ReportSample {
  reports: { id: string; sent: string[] }[];
  resolutions: string[];
}

// 看得到的回報與處理：有 canReview，且送出的段落全部看得到（拒答的回報：有 canReview 即可）
export function expectedReportVisible(access: AccessFile, data: Sample, reports: ReportSample, identityId: string | null): Visible {
  const role = access.roles.find((r) => r.id === identityId);
  const passages = new Set(expectedVisible(access, data, identityId).passages);
  const ids = new Set(role?.canReview ? reports.reports.filter((r) => r.sent.every((p) => passages.has(p))).map((r) => r.id) : []);
  return {
    answer_reports: [...ids],
    answer_report_resolutions: reports.resolutions.filter((r) => ids.has(r)),
  };
}

export const REPORT_KEY_SQL: Record<string, string> = {
  answer_reports: "id",
  answer_report_resolutions: "report_id",
};

// 能否寫入回報：身分存在，送出的段落與提到的實體自己全部看得到（不要求 canReview）
export function canWriteReport(access: AccessFile, data: Sample, identityId: string | null, report: { sent: string[]; entities: string[] }): boolean {
  if (!access.roles.some((r) => r.id === identityId)) return false;
  const visible = expectedVisible(access, data, identityId);
  return report.sent.every((p) => visible.passages.includes(p)) && report.entities.every((e) => visible.entities.includes(e));
}

// 能否處理：看得到該回報（因此有 canReview），而且還沒有處理
export function canResolveReport(access: AccessFile, data: Sample, reports: ReportSample, identityId: string | null, report: string): boolean {
  return expectedReportVisible(access, data, reports, identityId).answer_reports.includes(report) && !reports.resolutions.includes(report);
}
