// 請上傳者確認的資料層（ADR 0011 決定 6，docs/data-model.md「請上傳者確認」）：審核者寫入請求、上傳者回答、讀取。
// 一律經 withIdentity()；誰能寫入、看得到什麼，完全交給 RLS（migration 0016）。只用 INSERT。
// 上傳者的回答只是說明：回答後接縫回到審核者，由審核者以 approve()／reject() 決定
import type { Database } from "../db/database";
import { ReviewError } from "./store";

// 回答的選擇，與接縫的選項相同（ui/seam-review.ts 的 SeamOption），加上「都不是，我來說明」
export type RequestChoice = "merge" | "new" | "keep" | "reject" | "other";

export interface RequestReply {
  choice: RequestChoice;
  // choice 為 merge 時的合併對象
  mergeInto?: string;
  // 只用於 other，選填；空白視為沒有
  note?: string;
}

export interface ReviewRequest {
  id: string;
  itemId: string;
  documentId: string;
  // 請求者與回答者的身分 id（角色層級，畫面只顯示角色與時間）
  requestedBy: string;
  requestedAt: string;
  // 還沒回答，或回答的合併對象目前身分看不到時是 null
  reply: { choice: RequestChoice; mergeInto: string | null; note: string | null; repliedBy: string; repliedAt: string } | null;
  // 文件是目前身分上傳的（上傳者的首頁「有更新」用）
  mine: boolean;
  // 項目已有有效的決定（審核者已決定，請求不再需要處理）
  decided: boolean;
}

// 說明的字數上限（migration 0016 的 CHECK）
export const MAX_REPLY_NOTE_CHARS = 500;

export const newRequestId = () => `rq-${crypto.randomUUID()}`;

// 42501：被 RLS 拒絕；23502：沒有身分；23503：外鍵；23514：違反 CHECK；23505：同一個請求已回答。資料庫的訊息不顯示在畫面上
function mapError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === "42501" || code === "23502" || code === "23503" || code === "23514") throw new ReviewError("denied");
  if (code === "23505") throw new ReviewError("conflict");
  throw e;
}

// 審核者請上傳者確認一個待審項目，回傳請求的 id。文件由項目帶入；看不到項目、沒有 canReview、上傳者就是自己、
// 項目已有決定或還有沒回答的請求時拒絕（denied）
export async function requestUploader(db: Database, identityId: string | null, itemId: string): Promise<string> {
  const id = newRequestId();
  try {
    await db.withIdentity(identityId, async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO kk.review_requests (id, item_id, document_id, requested_by)
         SELECT $1, x.id, x.document_id, kk.current_identity_id()
           FROM (SELECT id, document_id FROM kk.pending_entities WHERE id = $2
                 UNION ALL SELECT id, document_id FROM kk.pending_relations WHERE id = $2) x`,
        [id, itemId],
      );
      if (inserted.affectedRows !== 1) throw new ReviewError("denied");
    });
  } catch (e) {
    if (e instanceof ReviewError) throw e;
    mapError(e);
  }
  return id;
}

// 上傳者回答一個請求（每個請求一次，第二次是 conflict）
export async function replyToRequest(db: Database, identityId: string | null, requestId: string, reply: RequestReply): Promise<void> {
  const note = reply.choice === "other" ? reply.note?.trim() || null : null;
  if (note !== null && [...note].length > MAX_REPLY_NOTE_CHARS) throw new ReviewError("denied");
  try {
    await db.withIdentity(identityId, (tx) =>
      tx.query(
        `INSERT INTO kk.review_request_replies (request_id, replied_by, choice, merge_into, note)
         VALUES ($1, kk.current_identity_id(), $2, $3, $4)`,
        [requestId, reply.choice, reply.mergeInto ?? null, note],
      ),
    );
  } catch (e) {
    mapError(e);
  }
}

const TIME = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

// 目前身分看得到的請求與回答，舊的在前。審核者讀得到看得到的文件的請求，上傳者讀得到自己文件的請求（0016）
export function readRequests(db: Database, identityId: string | null): Promise<ReviewRequest[]> {
  return db.withIdentity(identityId, async (tx) => {
    const rows = (
      await tx.query<{
        id: string;
        item_id: string;
        document_id: string;
        requested_by: string;
        requested_at: string;
        mine: boolean;
        decided: boolean;
        choice: RequestChoice | null;
        merge_into: string | null;
        note: string | null;
        replied_by: string | null;
        replied_at: string | null;
      }>(
        `SELECT q.id, q.item_id, q.document_id, q.requested_by, ${TIME("q.requested_at")} AS requested_at,
                d.uploaded_by = kk.current_identity_id() AS mine, kk.next_round(q.item_id) IS NULL AS decided,
                a.choice, a.merge_into, a.note, a.replied_by, ${TIME("a.replied_at")} AS replied_at
           FROM kk.review_requests q JOIN kk.documents d ON d.id = q.document_id
           LEFT JOIN kk.review_request_replies a ON a.request_id = q.id
          ORDER BY q.requested_at, q.id`,
      )
    ).rows;
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      documentId: r.document_id,
      requestedBy: r.requested_by,
      requestedAt: r.requested_at,
      reply:
        r.choice === null
          ? null
          : { choice: r.choice, mergeInto: r.merge_into, note: r.note, repliedBy: r.replied_by!, repliedAt: r.replied_at! },
      mine: r.mine,
      decided: r.decided,
    }));
  });
}
