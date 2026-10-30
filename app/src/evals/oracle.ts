// docs/data-model.md「權限規則」的獨立實作（不經過 SQL），用來算出每個身分「應該看得到」的列。
// 評測台以此判定權限滲漏（docs/evals.md）；滲漏矩陣等測試由 app/tests/db/oracle.ts 重新匯出（#62 決定 B）。
import type { AccessFile } from "../client/types";
import type { Dataset } from "../dataset/load";

export interface Doc {
  id: string;
  level: string;
  project: string | null;
}
export interface Passage {
  id: string;
  doc: string;
  level: string;
  project: string | null;
}
export interface Entity {
  id: string;
  sources: string[];
}
export interface Relation {
  id: string;
  from: string;
  to: string;
  sources: string[];
}
export interface Sample {
  docs: Doc[];
  passages: Passage[];
  entities: Entity[];
  relations: Relation[];
}

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

// 每張表用來比對的鍵（SQL 端以相同的欄位組出字串，見 app/tests/db/oracle.ts 的 KEY_SQL）
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

// 資料集（client/data/）轉成 expectedVisible() 的輸入形狀：段落套用沿用規則（docs/dataset.md）
export function datasetSample(dataset: Dataset): Sample {
  const documents = Object.values(dataset.documents);
  return {
    docs: documents.map((d) => ({ id: d.id, level: d.visibility, project: d.project ?? null })),
    passages: documents.flatMap((d) =>
      d.passages.map((p) => ({ id: p.id, doc: d.id, level: p.visibility ?? d.visibility, project: p.project ?? d.project ?? null })),
    ),
    entities: dataset.entities.entities.map((e) => ({ id: e.id, sources: e.sources })),
    relations: dataset.relations.relations.map((r) => ({ id: r.id, from: r.from, to: r.to, sources: r.sources })),
  };
}
