// 說法不同的資料層（docs/data-model.md「說法不同」）：寫入偵測結果、讀取、處理。
// 一律經 withIdentity()；誰能寫入、看得到、處理什麼，完全交給 RLS（migration 0008）。只用 INSERT。
import type { Database } from "../db/database";
import { ReviewError } from "../extraction/store";

export type ConflictDecision = "coexist" | "supersede" | "not_conflict";

export interface ConflictPair {
  id: string;
  // 新文件（上傳的文件）的段落
  newPassage: string;
  // 送出比對的既有段落
  oldPassage: string;
  // 模型的差異說明（純文字）
  summary: string;
}

export interface ConflictPassage {
  id: string;
  documentId: string;
  documentTitle: string;
  // 文件的可見等級、專案與日期（畫面上的標籤）
  visibility: string;
  project: string | null;
  date: string | null;
  language: string;
  content: string;
}

export interface ConflictItem {
  id: string;
  // 新文件
  documentId: string;
  summary: string;
  newPassage: ConflictPassage;
  oldPassage: ConflictPassage;
  // 尚未處理時為 null
  decision: ConflictDecision | null;
}

export const newConflictId = () => `pc-${crypto.randomUUID()}`;

// 42501：被 RLS 拒絕；23503：外鍵（段落不存在或不屬於該文件）；23514：違反 CHECK（id 格式、說明長度、同一段）；
// 23505：同一組合已寫入，或同一組已有決定。資料庫的訊息不顯示在畫面上
function mapError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === "42501" || code === "23503" || code === "23514") throw new ReviewError("denied");
  if (code === "23505") throw new ReviewError("conflict");
  throw e;
}

// 上傳者為自己上傳的文件寫入偵測結果，一個交易內全部寫入或全部不寫。
// 寫入後，沒有 canReview 的上傳者讀不到（未處理的紀錄只有核准者看得到），所以不使用 RETURNING
export async function writeConflicts(db: Database, identityId: string | null, documentId: string, pairs: readonly ConflictPair[]): Promise<void> {
  try {
    await db.withIdentity(identityId, async (tx) => {
      for (const p of pairs) {
        await tx.query("INSERT INTO kk.conflicts (id, document_id, new_passage_id, old_passage_id, summary) VALUES ($1, $2, $3, $4, $5)", [
          p.id,
          documentId,
          p.newPassage,
          p.oldPassage,
          p.summary,
        ]);
      }
    });
  } catch (e) {
    mapError(e);
  }
}

// 段落與所屬文件的欄位，組成 ConflictPassage 的形狀
const PASSAGE = (p: string, d: string) => `json_build_object(
  'id', ${p}.id, 'documentId', ${p}.document_id, 'documentTitle', ${d}.title, 'visibility', ${d}.visibility_level_id,
  'project', ${d}.project_id, 'date', to_char(${d}.document_date, 'YYYY-MM-DD'), 'language', ${p}.language, 'content', ${p}.content)`;

// 目前身分看得到的偵測結果與決定：核准者看得到兩段都可見的全部紀錄，其他身分只看得到兩段都可見的「並存」「取代」
export function readConflicts(db: Database, identityId: string | null): Promise<ConflictItem[]> {
  return db.withIdentity(identityId, async (tx) => {
    const rows = (
      await tx.query<{ id: string; document_id: string; summary: string; decision: ConflictDecision | null; new: ConflictPassage; old: ConflictPassage }>(
        `SELECT c.id, c.document_id, c.summary, r.decision, ${PASSAGE("n", "nd")} AS new, ${PASSAGE("o", "od")} AS old
           FROM kk.conflicts c
           JOIN kk.passages n ON n.id = c.new_passage_id JOIN kk.documents nd ON nd.id = n.document_id
           JOIN kk.passages o ON o.id = c.old_passage_id JOIN kk.documents od ON od.id = o.document_id
           LEFT JOIN kk.conflict_decisions r ON r.conflict_id = c.id
          ORDER BY c.document_id, n.ordinal, o.document_id, o.ordinal, c.id`,
      )
    ).rows;
    return rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      summary: r.summary,
      newPassage: r.new,
      oldPassage: r.old,
      decision: r.decision,
    }));
  });
}

// 處理一組：兩段的 id 從看得到的偵測結果帶入（複合外鍵保證一致）。看不到該組時沒有可寫入的列，視為拒絕
export async function decideConflict(db: Database, identityId: string | null, conflictId: string, decision: ConflictDecision): Promise<void> {
  try {
    await db.withIdentity(identityId, async (tx) => {
      const result = await tx.query(
        `INSERT INTO kk.conflict_decisions (conflict_id, new_passage_id, old_passage_id, decision, decided_by)
         SELECT c.id, c.new_passage_id, c.old_passage_id, $2, kk.current_identity_id() FROM kk.conflicts c WHERE c.id = $1`,
        [conflictId, decision],
      );
      if (result.affectedRows === 0) throw new ReviewError("denied");
    });
  } catch (e) {
    if (e instanceof ReviewError) throw e;
    mapError(e);
  }
}
