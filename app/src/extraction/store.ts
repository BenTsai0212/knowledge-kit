// 萃取結果的資料層（docs/data-model.md「待審與核准」）：寫入待審、讀取待審區、核准、退回。
// 一律經 withIdentity()；誰能寫入、看得到、核准什麼，完全交給 RLS（migration 0006）。只用 INSERT。
import type { LanguageCode, LocalizedText } from "../client/types";
import type { Database } from "../db/database";
import type { SourcePassage } from "../graph/read";

export interface PendingInput {
  entities: { id: string; type: string; names: LocalizedText; sources: string[] }[];
  // from、to 是同一份文件的待審實體 id
  relations: { id: string; type: string; from: string; to: string; sources: string[] }[];
  // 為前幾批已寫入的待審實體或關係補上出處（同一份文件中的去重，docs/extraction.md）
  addedSources?: { entity?: string; relation?: string; passages: string[] }[];
}

export type ReviewStatus = "pending" | "approved" | "rejected";

export interface ReviewEntity {
  id: string;
  type: string;
  names: LocalizedText;
  sources: SourcePassage[];
  status: ReviewStatus;
  // 核准時合併到的既有實體
  mergedInto: string | null;
}

export interface ReviewRelation {
  id: string;
  type: string;
  from: string;
  to: string;
  sources: SourcePassage[];
  status: ReviewStatus;
  // 因兩端的實體被退回而一併退回（#44 決定 2）
  rejectedWithEntity: boolean;
}

export interface ReviewDocument {
  id: string;
  title: string;
  language: string;
  entities: ReviewEntity[];
  relations: ReviewRelation[];
}

export interface EntityApproval {
  id: string;
  // 核准前修改的名稱（只用於建立新實體）
  names?: LocalizedText;
  // 合併到的既有實體；省略時建立新實體
  mergeInto?: string;
}

export class ReviewError extends Error {
  constructor(readonly reason: "denied" | "conflict") {
    super(reason === "denied" ? "沒有權限處理這個項目" : "這個項目已經被處理過");
  }
}

// 待審實體與關係的 id；核准為新實體時，正式資料的 id 沿用待審的 id（policy 以此對應核准的決定）
export const newPendingEntityId = () => `pe-${crypto.randomUUID()}`;
export const newPendingRelationId = () => `pr-${crypto.randomUUID()}`;

// 42501：被 RLS 拒絕或沒有權限；23503：外鍵（例如合併對象不存在）；23514：違反 CHECK（例如待審 id 的格式）；
// 23505：同一個項目已有決定。資料庫的訊息不顯示在畫面上
function mapError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === "42501" || code === "23503" || code === "23514") throw new ReviewError("denied");
  if (code === "23505") throw new ReviewError("conflict");
  throw e;
}

// 上傳者寫入自己文件的萃取結果；寫入後上傳者讀不到（只有核准者看得到），所以不使用 RETURNING
export async function writePending(db: Database, identityId: string | null, documentId: string, input: PendingInput): Promise<void> {
  try {
    await db.withIdentity(identityId, async (tx) => {
      for (const e of input.entities) {
        await tx.query("INSERT INTO kk.pending_entities (id, document_id, entity_type, names) VALUES ($1, $2, $3, $4)", [
          e.id,
          documentId,
          e.type,
          e.names,
        ]);
        for (const p of e.sources) {
          await tx.query("INSERT INTO kk.pending_entity_sources (pending_entity_id, document_id, passage_id) VALUES ($1, $2, $3)", [
            e.id,
            documentId,
            p,
          ]);
        }
      }
      for (const added of input.addedSources ?? []) {
        for (const p of added.passages) {
          if (added.entity !== undefined) {
            await tx.query(
              "INSERT INTO kk.pending_entity_sources (pending_entity_id, document_id, passage_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
              [added.entity, documentId, p],
            );
          }
          if (added.relation !== undefined) {
            await tx.query(
              "INSERT INTO kk.pending_relation_sources (pending_relation_id, document_id, passage_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
              [added.relation, documentId, p],
            );
          }
        }
      }
      for (const r of input.relations) {
        await tx.query(
          "INSERT INTO kk.pending_relations (id, document_id, relation_type, from_pending_id, to_pending_id) VALUES ($1, $2, $3, $4, $5)",
          [r.id, documentId, r.type, r.from, r.to],
        );
        for (const p of r.sources) {
          await tx.query("INSERT INTO kk.pending_relation_sources (pending_relation_id, document_id, passage_id) VALUES ($1, $2, $3)", [
            r.id,
            documentId,
            p,
          ]);
        }
      }
    });
  } catch (e) {
    mapError(e);
  }
}

const SOURCES = (table: string, column: string) => `
  SELECT s.${column} AS owner_id, p.id, p.document_id, d.title AS document_title, p.language, p.content
    FROM kk.${table} s JOIN kk.passages p ON p.id = s.passage_id JOIN kk.documents d ON d.id = p.document_id
   ORDER BY s.${column}, p.ordinal`;

interface SourceRow {
  owner_id: string;
  id: string;
  document_id: string;
  document_title: string;
  language: string;
  content: string;
}

function group(rows: SourceRow[]): Map<string, SourcePassage[]> {
  const out = new Map<string, SourcePassage[]>();
  for (const r of rows) {
    const list = out.get(r.owner_id) ?? [];
    list.push({ id: r.id, documentId: r.document_id, documentTitle: r.document_title, language: r.language, content: r.content });
    out.set(r.owner_id, list);
  }
  return out;
}

const statusOf = (decision: string | null): ReviewStatus => (decision === null ? "pending" : decision === "approve" ? "approved" : "rejected");

// 待審區：目前身分看得到的待審項目與決定，依文件分組（沒有 canReview 時為空）
export function readReview(db: Database, identityId: string | null): Promise<ReviewDocument[]> {
  return db.withIdentity(identityId, async (tx) => {
    const entities = (
      await tx.query<{ id: string; document_id: string; title: string; language: string; entity_type: string; names: LocalizedText; decision: string | null; merge_into: string | null }>(
        `SELECT p.id, p.document_id, d.title, d.language, p.entity_type, p.names, r.decision, r.merge_into
           FROM kk.pending_entities p JOIN kk.documents d ON d.id = p.document_id
           LEFT JOIN kk.review_decisions r ON r.item_id = p.id
          ORDER BY p.document_id, p.id`,
      )
    ).rows;
    const relations = (
      await tx.query<{ id: string; document_id: string; relation_type: string; from_pending_id: string; to_pending_id: string; decision: string | null }>(
        `SELECT p.id, p.document_id, p.relation_type, p.from_pending_id, p.to_pending_id, r.decision
           FROM kk.pending_relations p LEFT JOIN kk.review_decisions r ON r.item_id = p.id
          ORDER BY p.document_id, p.id`,
      )
    ).rows;
    const entitySources = group((await tx.query<SourceRow>(SOURCES("pending_entity_sources", "pending_entity_id"))).rows);
    const relationSources = group((await tx.query<SourceRow>(SOURCES("pending_relation_sources", "pending_relation_id"))).rows);

    const documents = new Map<string, ReviewDocument>();
    for (const e of entities) {
      const doc = documents.get(e.document_id) ?? { id: e.document_id, title: e.title, language: e.language, entities: [], relations: [] };
      doc.entities.push({
        id: e.id,
        type: e.entity_type,
        names: e.names,
        sources: entitySources.get(e.id) ?? [],
        status: statusOf(e.decision),
        mergedInto: e.merge_into,
      });
      documents.set(e.document_id, doc);
    }
    for (const r of relations) {
      const doc = documents.get(r.document_id);
      if (doc === undefined) continue;
      const endpoints = doc.entities.filter((e) => e.id === r.from_pending_id || e.id === r.to_pending_id);
      const status = statusOf(r.decision);
      doc.relations.push({
        id: r.id,
        type: r.relation_type,
        from: r.from_pending_id,
        to: r.to_pending_id,
        sources: relationSources.get(r.id) ?? [],
        status,
        rejectedWithEntity: status === "rejected" && endpoints.some((e) => e.status === "rejected"),
      });
    }
    return [...documents.values()];
  });
}

// 在一個交易中核准：先實體（寫決定，再建立新實體或把出處加到合併對象），再關係（兩端都已核准）。任何一列被拒絕就全部不寫入
export async function approve(
  db: Database,
  identityId: string | null,
  items: { entities: EntityApproval[]; relations: string[] },
  options: { defaultLanguage: LanguageCode },
): Promise<void> {
  try {
    await db.withIdentity(identityId, async (tx) => {
      for (const e of items.entities) {
        await tx.query(
          "INSERT INTO kk.review_decisions (item_id, decision, decided_by, names, merge_into) VALUES ($1, 'approve', kk.current_identity_id(), $2, $3)",
          [e.id, e.names ?? null, e.mergeInto ?? null],
        );
        if (e.mergeInto !== undefined) {
          // 合併：既有實體的名稱不變，只加上出處（#44 決定 5）
          await tx.query(
            `INSERT INTO kk.entity_sources (entity_id, passage_id)
             SELECT $2, s.passage_id FROM kk.pending_entity_sources s WHERE s.pending_entity_id = $1
             ON CONFLICT DO NOTHING`,
            [e.id, e.mergeInto],
          );
          continue;
        }
        const pending = (await tx.query<{ entity_type: string; names: LocalizedText }>("SELECT entity_type, names FROM kk.pending_entities WHERE id = $1", [e.id]))
          .rows[0];
        if (pending === undefined) throw new ReviewError("denied");
        const names = e.names ?? pending.names;
        await tx.query("INSERT INTO kk.entities (id, entity_type, name, names) VALUES ($1, $2, $3, $4)", [
          e.id,
          pending.entity_type,
          names[options.defaultLanguage] ?? Object.values(names)[0],
          names,
        ]);
        await tx.query(
          `INSERT INTO kk.entity_sources (entity_id, passage_id)
           SELECT $1, s.passage_id FROM kk.pending_entity_sources s WHERE s.pending_entity_id = $1`,
          [e.id],
        );
      }
      for (const id of items.relations) {
        await tx.query("INSERT INTO kk.review_decisions (item_id, decision, decided_by) VALUES ($1, 'approve', kk.current_identity_id())", [id]);
        // 兩端解析成核准後的實體：合併對象或新建的實體
        await tx.query(
          `INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id)
           SELECT r.id, r.relation_type, coalesce(f.merge_into, f.item_id), coalesce(t.merge_into, t.item_id)
             FROM kk.pending_relations r
             JOIN kk.review_decisions f ON f.item_id = r.from_pending_id
             JOIN kk.review_decisions t ON t.item_id = r.to_pending_id
            WHERE r.id = $1`,
          [id],
        );
        await tx.query(
          `INSERT INTO kk.relation_sources (relation_id, passage_id, from_entity_id, to_entity_id)
           SELECT s.pending_relation_id, s.passage_id, coalesce(f.merge_into, f.item_id), coalesce(t.merge_into, t.item_id)
             FROM kk.pending_relation_sources s
             JOIN kk.pending_relations r ON r.id = s.pending_relation_id
             JOIN kk.review_decisions f ON f.item_id = r.from_pending_id
             JOIN kk.review_decisions t ON t.item_id = r.to_pending_id
            WHERE s.pending_relation_id = $1`,
          [id],
        );
      }
    });
  } catch (e) {
    mapError(e);
  }
}

// 退回：寫 reject 決定。退回實體時，依附它、還沒有決定的待審關係一併退回（#44 決定 2）
export async function reject(db: Database, identityId: string | null, items: { entities: string[]; relations: string[] }): Promise<void> {
  try {
    await db.withIdentity(identityId, async (tx) => {
      // 同一個交易中已退回的項目（例如依附實體而一併退回的關係），不再重複寫入
      const rejected = new Set<string>();
      const decide = async (id: string) => {
        if (rejected.has(id)) return;
        rejected.add(id);
        await tx.query("INSERT INTO kk.review_decisions (item_id, decision, decided_by) VALUES ($1, 'reject', kk.current_identity_id())", [id]);
      };
      for (const id of items.entities) {
        await decide(id);
        const dependents = await tx.query<{ id: string }>(
          `SELECT r.id FROM kk.pending_relations r LEFT JOIN kk.review_decisions d ON d.item_id = r.id
            WHERE (r.from_pending_id = $1 OR r.to_pending_id = $1) AND d.item_id IS NULL`,
          [id],
        );
        for (const r of dependents.rows) await decide(r.id);
      }
      for (const id of items.relations) await decide(id);
    });
  } catch (e) {
    mapError(e);
  }
}
