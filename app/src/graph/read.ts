// 知識圖譜：一次讀出目前身分看得到的實體與關係，以及各自的出處段落（docs/data-model.md「權限規則」）。
// 一律經 withIdentity()，看得到哪些列完全交給 RLS；本模組不另外判斷權限。
import type { LocalizedText } from "../client/types";
import type { Database } from "../db/database";

export interface SourcePassage {
  id: string;
  documentId: string;
  documentTitle: string;
  language: string;
  content: string;
}

export interface GraphEntity {
  id: string;
  type: string;
  name: string;
  // 各介面語言的顯示名稱
  names: LocalizedText;
  sources: SourcePassage[];
}

export interface GraphRelation {
  id: string;
  type: string;
  from: string;
  to: string;
  sources: SourcePassage[];
}

export interface Graph {
  entities: GraphEntity[];
  relations: GraphRelation[];
}

interface SourceRow {
  owner_id: string;
  id: string;
  document_id: string;
  document_title: string;
  language: string;
  content: string;
}

// 出處表（entity_sources／relation_sources）只回傳看得到的段落；JOIN 的段落與文件同樣受 RLS 篩選
const sourcesSql = (table: string, ownerColumn: string) => `
  SELECT s.${ownerColumn} AS owner_id, p.id, p.document_id, d.title AS document_title, p.language, p.content
    FROM kk.${table} s
    JOIN kk.passages p ON p.id = s.passage_id
    JOIN kk.documents d ON d.id = p.document_id
   ORDER BY s.${ownerColumn}, d.id, p.ordinal`;

function groupSources(rows: SourceRow[]): Map<string, SourcePassage[]> {
  const byOwner = new Map<string, SourcePassage[]>();
  for (const r of rows) {
    const list = byOwner.get(r.owner_id) ?? [];
    list.push({ id: r.id, documentId: r.document_id, documentTitle: r.document_title, language: r.language, content: r.content });
    byOwner.set(r.owner_id, list);
  }
  return byOwner;
}

export function readGraph(db: Database, identityId: string | null): Promise<Graph> {
  return db.withIdentity(identityId, async (tx) => {
    const entities = await tx.query<{ id: string; entity_type: string; name: string; names: LocalizedText }>(
      "SELECT id, entity_type, name, names FROM kk.entities ORDER BY id",
    );
    const relations = await tx.query<{ id: string; relation_type: string; from_entity_id: string; to_entity_id: string }>(
      "SELECT id, relation_type, from_entity_id, to_entity_id FROM kk.relations ORDER BY id",
    );
    const entitySources = groupSources((await tx.query<SourceRow>(sourcesSql("entity_sources", "entity_id"))).rows);
    const relationSources = groupSources((await tx.query<SourceRow>(sourcesSql("relation_sources", "relation_id"))).rows);

    return {
      entities: entities.rows.map((e) => ({
        id: e.id,
        type: e.entity_type,
        name: e.name,
        names: e.names,
        sources: entitySources.get(e.id) ?? [],
      })),
      relations: relations.rows.map((r) => ({
        id: r.id,
        type: r.relation_type,
        from: r.from_entity_id,
        to: r.to_entity_id,
        sources: relationSources.get(r.id) ?? [],
      })),
    };
  });
}
