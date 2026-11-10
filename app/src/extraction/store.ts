// 萃取結果的資料層（docs/data-model.md「待審與核准」）：寫入待審、讀取待審區、核准、退回、撤回。
// 一律經 withIdentity()；誰能寫入、看得到、核准與撤回什麼，完全交給 RLS（migration 0006、0009）。只用 INSERT。
import type { Transaction } from "@electric-sql/pglite";
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
  // 目前有效的決定（撤回用；待審時為 null）
  decisionId: string | null;
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
  decisionId: string | null;
  // 因兩端的實體被退回而一併退回（#44 決定 2）
  rejectedWithEntity: boolean;
}

export interface ReviewDocument {
  id: string;
  title: string;
  language: string;
  // 文件的可見等級與專案（畫面上的標籤）
  visibility: string;
  project: string | null;
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

// 待審實體與關係的 id。核准為新實體時，正式資料的 id 是決定的 id：第 1 次決定等於待審的 id，撤回後再決定是 <id>~<round>（0009）
export const newPendingEntityId = () => `pe-${crypto.randomUUID()}`;
export const newPendingRelationId = () => `pr-${crypto.randomUUID()}`;

// 42501：被 RLS 拒絕或沒有權限；23503：外鍵（例如合併對象不存在）；23514：違反 CHECK（例如待審 id 的格式）；
// 23505：同一個項目同時寫入決定，或同一個決定已撤回。資料庫的訊息不顯示在畫面上
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

// 未撤回的決定（每個項目最多一筆）
const ACTIVE = (alias: string) => `NOT EXISTS (SELECT 1 FROM kk.review_retractions x WHERE x.decision_id = ${alias}.id)`;

// 待審區：目前身分看得到的待審項目與目前有效的決定，依文件分組（沒有 canReview 時為空）。
// 沒有決定、或所有決定都已撤回的項目是待審
export function readReview(db: Database, identityId: string | null): Promise<ReviewDocument[]> {
  return db.withIdentity(identityId, async (tx) => {
    const entities = (
      await tx.query<{
        id: string;
        document_id: string;
        title: string;
        language: string;
        visibility: string;
        project: string | null;
        entity_type: string;
        names: LocalizedText;
        decision: string | null;
        decision_id: string | null;
        merge_into: string | null;
      }>(
        `SELECT p.id, p.document_id, d.title, d.language, d.visibility_level_id AS visibility, d.project_id AS project,
                p.entity_type, p.names, r.decision, r.id AS decision_id, r.merge_into
           FROM kk.pending_entities p JOIN kk.documents d ON d.id = p.document_id
           LEFT JOIN kk.review_decisions r ON r.item_id = p.id AND ${ACTIVE("r")}
          ORDER BY p.document_id, p.id`,
      )
    ).rows;
    const relations = (
      await tx.query<{
        id: string;
        document_id: string;
        relation_type: string;
        from_pending_id: string;
        to_pending_id: string;
        decision: string | null;
        decision_id: string | null;
      }>(
        `SELECT p.id, p.document_id, p.relation_type, p.from_pending_id, p.to_pending_id, r.decision, r.id AS decision_id
           FROM kk.pending_relations p LEFT JOIN kk.review_decisions r ON r.item_id = p.id AND ${ACTIVE("r")}
          ORDER BY p.document_id, p.id`,
      )
    ).rows;
    const entitySources = group((await tx.query<SourceRow>(SOURCES("pending_entity_sources", "pending_entity_id"))).rows);
    const relationSources = group((await tx.query<SourceRow>(SOURCES("pending_relation_sources", "pending_relation_id"))).rows);

    const documents = new Map<string, ReviewDocument>();
    for (const e of entities) {
      const doc = documents.get(e.document_id) ?? {
        id: e.document_id,
        title: e.title,
        language: e.language,
        visibility: e.visibility,
        project: e.project,
        entities: [],
        relations: [],
      };
      doc.entities.push({
        id: e.id,
        type: e.entity_type,
        names: e.names,
        sources: entitySources.get(e.id) ?? [],
        status: statusOf(e.decision),
        decisionId: e.decision_id,
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
        decisionId: r.decision_id,
        rejectedWithEntity: status === "rejected" && endpoints.some((e) => e.status === "rejected"),
      });
    }
    return [...documents.values()];
  });
}

// 待審關係 r 的兩端：兩個待審實體目前有效的核准，解析成核准後的實體（合併對象或新建的實體）
const ENDPOINTS = `
    JOIN kk.review_decisions f ON f.item_id = r.from_pending_id AND f.decision = 'approve' AND ${ACTIVE("f")}
    JOIN kk.review_decisions t ON t.item_id = r.to_pending_id AND t.decision = 'approve' AND ${ACTIVE("t")}`;
const FROM = "coalesce(f.merge_into, f.id)";
const TO = "coalesce(t.merge_into, t.id)";

// 兩端解析後，類型與兩端都相同、核准者看得到的既有關係（#189）
const EXISTING_RELATION = `
  SELECT x.id FROM kk.pending_relations r ${ENDPOINTS}
    JOIN kk.relations x ON x.relation_type = r.relation_type AND x.from_entity_id = ${FROM} AND x.to_entity_id = ${TO}
   WHERE r.id = $1 LIMIT 1`;

// 寫入一筆決定，回傳決定的 id。項目已有有效的決定時是 conflict；round 由 policy 檢查，同時寫入由唯一鍵擋掉
async function decide(tx: Transaction, itemId: string, decision: "approve" | "reject", extra: { names?: LocalizedText; mergeInto?: string } = {}): Promise<string> {
  const round = (await tx.query<{ n: number | null }>("SELECT kk.next_round($1) AS n", [itemId])).rows[0].n;
  if (round === null) throw new ReviewError("conflict");
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO kk.review_decisions (item_id, round, decision, decided_by, names, merge_into)
     VALUES ($1, $2, $3, kk.current_identity_id(), $4, $5) RETURNING id`,
    [itemId, round, decision, extra.names ?? null, extra.mergeInto ?? null],
  );
  return inserted.rows[0].id;
}

// 在一個交易中核准：先實體（寫決定，再建立新實體或把出處加到合併對象），再關係（兩端都已核准）。任何一列被拒絕就全部不寫入。
// 圖譜已有的關係只寫決定，不建立關係與出處（#189 決定 1）：existingRelations 是畫面算出的圖譜已有，寫入前在同一個交易再查一次，
// 已經不存在時整筆不寫入（conflict）；relations 查到相同的既有關係時（例如舊的分頁、同時開兩個分頁）也只寫決定。
// 回傳寫入的決定 id（「撤銷」時交給 retract()，ADR 0007 決定 4）
export async function approve(
  db: Database,
  identityId: string | null,
  items: { entities: EntityApproval[]; relations: string[]; existingRelations?: string[] },
  options: { defaultLanguage: LanguageCode },
): Promise<string[]> {
  try {
    return await db.withIdentity(identityId, async (tx) => {
      const written: string[] = [];
      for (const e of items.entities) {
        const decisionId = await decide(tx, e.id, "approve", { names: e.names, mergeInto: e.mergeInto });
        written.push(decisionId);
        if (e.mergeInto !== undefined) {
          // 合併：既有實體的名稱不變，只加上出處（#44 決定 5）
          await tx.query(
            `INSERT INTO kk.entity_sources (entity_id, passage_id, decision_id)
             SELECT $2, s.passage_id, $3 FROM kk.pending_entity_sources s WHERE s.pending_entity_id = $1`,
            [e.id, e.mergeInto, decisionId],
          );
          continue;
        }
        const pending = (await tx.query<{ entity_type: string; names: LocalizedText }>("SELECT entity_type, names FROM kk.pending_entities WHERE id = $1", [e.id]))
          .rows[0];
        if (pending === undefined) throw new ReviewError("denied");
        const names = e.names ?? pending.names;
        await tx.query("INSERT INTO kk.entities (id, entity_type, name, names) VALUES ($1, $2, $3, $4)", [
          decisionId,
          pending.entity_type,
          names[options.defaultLanguage] ?? Object.values(names)[0],
          names,
        ]);
        await tx.query(
          `INSERT INTO kk.entity_sources (entity_id, passage_id, decision_id)
           SELECT $2, s.passage_id, $2 FROM kk.pending_entity_sources s WHERE s.pending_entity_id = $1`,
          [e.id, decisionId],
        );
      }
      for (const id of items.existingRelations ?? []) {
        written.push(await decide(tx, id, "approve"));
        if ((await tx.query(EXISTING_RELATION, [id])).rows.length === 0) throw new ReviewError("conflict");
      }
      for (const id of items.relations) {
        const decisionId = await decide(tx, id, "approve");
        written.push(decisionId);
        if ((await tx.query(EXISTING_RELATION, [id])).rows.length > 0) continue;
        await tx.query(
          `INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id)
           SELECT $2, r.relation_type, ${FROM}, ${TO} FROM kk.pending_relations r ${ENDPOINTS} WHERE r.id = $1`,
          [id, decisionId],
        );
        await tx.query(
          `INSERT INTO kk.relation_sources (relation_id, passage_id, from_entity_id, to_entity_id, decision_id)
           SELECT $2, s.passage_id, ${FROM}, ${TO}, $2
             FROM kk.pending_relation_sources s JOIN kk.pending_relations r ON r.id = s.pending_relation_id ${ENDPOINTS}
            WHERE s.pending_relation_id = $1`,
          [id, decisionId],
        );
      }
      return written;
    });
  } catch (e) {
    mapError(e);
  }
}

// 退回：寫 reject 決定。退回實體時，依附它、還沒有決定的待審關係一併退回（#44 決定 2）。
// 回傳寫入的決定 id，含一併退回的關係（「撤銷」時全部交給 retract()，實體與關係才會一起回到待審）
export async function reject(db: Database, identityId: string | null, items: { entities: string[]; relations: string[] }): Promise<string[]> {
  try {
    return await db.withIdentity(identityId, async (tx) => {
      // 同一個交易中已退回的項目（例如依附實體而一併退回的關係），不再重複寫入
      const rejected = new Set<string>();
      const written: string[] = [];
      const rejectOnce = async (id: string) => {
        if (rejected.has(id)) return;
        rejected.add(id);
        written.push(await decide(tx, id, "reject"));
      };
      for (const id of items.entities) {
        await rejectOnce(id);
        // 沒有有效決定的關係（從未決定，或決定都已撤回）
        const dependents = await tx.query<{ id: string }>(
          "SELECT r.id FROM kk.pending_relations r WHERE (r.from_pending_id = $1 OR r.to_pending_id = $1) AND kk.next_round(r.id) IS NOT NULL",
          [id],
        );
        for (const r of dependents.rows) await rejectOnce(r.id);
      }
      for (const id of items.relations) await rejectOnce(id);
      return written;
    });
  } catch (e) {
    mapError(e);
  }
}

// 撤回實體的核准時連帶撤回的關係決定：端點是這個待審實體、已核准且未撤回（#209 決定 6）
async function cascaded(tx: Transaction, decisionId: string): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(
    `SELECT rd.id FROM kk.review_decisions ed
       JOIN kk.pending_relations r ON r.from_pending_id = ed.item_id OR r.to_pending_id = ed.item_id
       JOIN kk.review_decisions rd ON rd.item_id = r.id AND rd.decision = 'approve' AND ${ACTIVE("rd")}
      WHERE ed.id = $1 AND ed.decision = 'approve'
      ORDER BY rd.id`,
    [decisionId],
  );
  return rows.rows.map((r) => r.id);
}

// 撤回決定（ADR 0007）：寫入撤回紀錄，項目回到待審，這個決定寫入的出處不再算數。
// 撤回實體的核准時，同一份文件中端點是這個待審實體、已核准且未撤回的關係一併撤回（cascade_of 指向實體的撤回，#209 決定 6）。
// 看不到或不存在的決定（參考情境與資料集的內容沒有決定）是 denied，已撤回的決定是 conflict；任何一筆失敗就全部不寫入
export async function retract(db: Database, identityId: string | null, decisionIds: string[]): Promise<void> {
  try {
    await db.withIdentity(identityId, async (tx) => {
      // 同一個交易中已撤回的決定（例如「撤銷」全部核准時，連帶撤回的關係也在清單中），不再重複寫入
      const retracted = new Set<string>();
      const retractOne = async (id: string, cascadeOf: string | null) => {
        if (retracted.has(id)) return;
        retracted.add(id);
        const inserted = await tx.query(
          `INSERT INTO kk.review_retractions (decision_id, document_id, retracted_by, cascade_of)
           SELECT d.id, coalesce(e.document_id, r.document_id), kk.current_identity_id(), $2
             FROM kk.review_decisions d
             LEFT JOIN kk.pending_entities e ON e.id = d.item_id
             LEFT JOIN kk.pending_relations r ON r.id = d.item_id
            WHERE d.id = $1`,
          [id, cascadeOf],
        );
        if (inserted.affectedRows !== 1) throw new ReviewError("denied");
      };
      for (const id of decisionIds) {
        await retractOne(id, null);
        for (const r of await cascaded(tx, id)) await retractOne(r, id);
      }
    });
  } catch (e) {
    mapError(e);
  }
}

// 圖譜面板的「撤回此文件對它的核准」（ADR 0007）：實體在某份文件的出處由哪些決定寫入，以及撤回後目前身分的圖譜中會消失的實體與關係
export interface DocumentRetraction {
  documentId: string;
  // 交給 retract() 的決定（連帶撤回的關係由 retract() 處理）
  decisionIds: string[];
  entities: string[];
  relations: string[];
}

// 出處列：owner 是實體或關係，decision 為 null 的是參考情境與資料集的出處（撤回不了）
export interface SourceOf {
  owner: string;
  decision: string | null;
}

// 扣掉 removed 的決定寫入的出處後，沒有出處的實體與關係；一端消失的關係也算（docs/data-model.md「權限規則」）
export function vanishing(
  entitySources: SourceOf[],
  relationSources: (SourceOf & { from: string; to: string })[],
  removed: ReadonlySet<string>,
): { entities: string[]; relations: string[] } {
  const kept = (r: SourceOf) => r.decision === null || !removed.has(r.decision);
  const remaining = new Set(entitySources.filter(kept).map((r) => r.owner));
  const entities = [...new Set(entitySources.map((r) => r.owner))].filter((id) => !remaining.has(id)).sort();
  const remainingRelations = new Set(relationSources.filter((r) => kept(r) && remaining.has(r.from) && remaining.has(r.to)).map((r) => r.owner));
  const relations = [...new Set(relationSources.map((r) => r.owner))].filter((id) => !remainingRelations.has(id)).sort();
  return { entities, relations };
}

// 實體經審核進來的出處，依文件列出可以撤回的決定與撤回後會消失的內容。決定只有 canReview、看得到文件的身分讀得到（0006），
// 其他身分回傳空陣列；參考情境與資料集的出處沒有決定，不列出
export function readRetractions(db: Database, identityId: string | null, entityId: string): Promise<DocumentRetraction[]> {
  return db.withIdentity(identityId, async (tx) => {
    const decisions = (
      await tx.query<{ document_id: string; decision_id: string }>(
        `SELECT DISTINCT p.document_id, s.decision_id FROM kk.entity_sources s
           JOIN kk.passages p ON p.id = s.passage_id JOIN kk.review_decisions d ON d.id = s.decision_id
          WHERE s.entity_id = $1 ORDER BY p.document_id, s.decision_id`,
        [entityId],
      )
    ).rows;
    if (decisions.length === 0) return [];
    const entitySources = (await tx.query<SourceOf>("SELECT entity_id AS owner, decision_id AS decision FROM kk.entity_sources")).rows;
    const relationSources = (
      await tx.query<SourceOf & { from: string; to: string }>(
        `SELECT relation_id AS owner, decision_id AS decision, from_entity_id AS "from", to_entity_id AS "to" FROM kk.relation_sources`,
      )
    ).rows;
    const out: DocumentRetraction[] = [];
    for (const d of decisions) {
      let doc = out.find((x) => x.documentId === d.document_id);
      if (doc === undefined) out.push((doc = { documentId: d.document_id, decisionIds: [], entities: [], relations: [] }));
      doc.decisionIds.push(d.decision_id);
    }
    for (const doc of out) {
      const removed = new Set(doc.decisionIds);
      for (const id of doc.decisionIds) for (const r of await cascaded(tx, id)) removed.add(r);
      Object.assign(doc, vanishing(entitySources, relationSources, removed));
    }
    return out;
  });
}
