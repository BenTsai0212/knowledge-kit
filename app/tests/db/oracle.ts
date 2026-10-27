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
  const relations = data.relations.filter(
    (r) => r.sources.some((s) => passages.has(s)) && entities.has(r.from) && entities.has(r.to),
  );

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
    relation_sources: data.relations.flatMap((r) => r.sources.filter((s) => passages.has(s)).map((s) => `${r.id}|${s}`)),
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
