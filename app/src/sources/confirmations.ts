// 來源確認的資料層（ADR 0013，docs/data-model.md「來源確認」）：確認、撤銷確認、讀取目前狀態與失效判斷。
// 一律經 withIdentity()；誰能寫入、看得到什麼，完全交給 RLS（migration 0018）。只用 INSERT。
import type { Transaction } from "@electric-sql/pglite";
import type { ConflictDecision } from "../conflicts/store";
import type { Database } from "../db/database";
import { ReviewError } from "../extraction/store";

export type ConfirmationAction = "confirm" | "revoke";

// 已確認段落的失效判斷（ADR 0013 決定 6）：
// valid：有效；superseded：已被新的說法取代（passageId 是新的一段）；disputed：有不同說法（passageId 是另一段）
export type ConfirmationStatus = { kind: "valid" } | { kind: "superseded"; passageId: string } | { kind: "disputed"; passageId: string };

export interface PassageConfirmation {
  // 確認者的身分 id（角色層級，畫面只顯示角色與日期）與確認時間
  confirmedBy: string;
  confirmedAt: string;
  status: ConfirmationStatus;
}

// 目前身分看得到的一組說法不同；decision 是 null 表示尚未處理（只有 canReview 看得到）
export interface ConflictLink {
  newPassage: string;
  oldPassage: string;
  decision: ConflictDecision | null;
}

export const newConfirmationId = () => `cf-${crypto.randomUUID()}`;

// 42501：被 RLS 拒絕（沒有 canReview、看不到那一段）；23502：沒有身分；23503：不存在的段落；23514：違反 CHECK。資料庫的訊息不顯示在畫面上
function mapError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === "42501" || code === "23502" || code === "23503" || code === "23514") throw new ReviewError("denied");
  throw e;
}

// 確認或撤銷確認一段，回傳 id。不檢查目前狀態：重複確認、沒確認就撤銷都只是多一筆，不影響狀態（ADR 0013 決定 3）
export async function writeConfirmation(db: Database, identityId: string | null, passageId: string, action: ConfirmationAction): Promise<string> {
  const id = newConfirmationId();
  try {
    await db.withIdentity(identityId, (tx) =>
      tx.query(
        `INSERT INTO kk.passage_confirmations (id, passage_id, action, created_by) VALUES ($1, $2, $3, kk.current_identity_id())`,
        [id, passageId, action],
      ),
    );
  } catch (e) {
    mapError(e);
  }
  return id;
}

// 失效判斷的純函式：passageId 所在的說法不同中，取最嚴重的一種（被取代 > 有不同說法 > 有效）。
// 「以新的為準」的新的一段與「不是說法不同」不影響。links 依 readConflictLinks() 的順序，同一種取第一組
export function confirmationStatus(passageId: string, links: readonly ConflictLink[]): ConfirmationStatus {
  let disputed: string | null = null;
  for (const l of links) {
    if (l.decision === "not_conflict") continue;
    if (l.decision === "supersede") {
      if (l.oldPassage === passageId) return { kind: "superseded", passageId: l.newPassage };
      continue;
    }
    if (disputed === null && l.oldPassage === passageId) disputed = l.newPassage;
    else if (disputed === null && l.newPassage === passageId) disputed = l.oldPassage;
  }
  return disputed === null ? { kind: "valid" } : { kind: "disputed", passageId: disputed };
}

// 目前身分看得到的說法不同（含尚未處理的），新段落依文件日期由新到舊（與 marks.ts 相同，被多段取代時第一組是要顯示的）
export async function readConflictLinks(tx: Transaction): Promise<ConflictLink[]> {
  const rows = (
    await tx.query<{ new_passage_id: string; old_passage_id: string; decision: ConflictDecision | null }>(
      `SELECT c.new_passage_id, c.old_passage_id, d.decision
         FROM kk.conflicts c
         LEFT JOIN kk.conflict_decisions d ON d.conflict_id = c.id
         JOIN kk.passages n ON n.id = c.new_passage_id JOIN kk.documents nd ON nd.id = n.document_id
        ORDER BY nd.document_date DESC NULLS LAST, c.new_passage_id, c.old_passage_id`,
    )
  ).rows;
  return rows.map((r) => ({ newPassage: r.new_passage_id, oldPassage: r.old_passage_id, decision: r.decision }));
}

// 段落 id → 確認（只含目前狀態是「已確認」的段落）。在呼叫端的 withIdentity() 交易中讀取；
// RLS 只讓看得到的段落的紀錄被讀到，失效也只依目前身分看得到的說法不同判斷
export async function readPassageConfirmations(tx: Transaction): Promise<Map<string, PassageConfirmation>> {
  const rows = (
    await tx.query<{ passage_id: string; action: ConfirmationAction; created_by: string; created_at: string }>(
      `SELECT DISTINCT ON (passage_id) passage_id, action, created_by,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
         FROM kk.passage_confirmations
        ORDER BY passage_id, seq DESC`,
    )
  ).rows.filter((r) => r.action === "confirm");
  const out = new Map<string, PassageConfirmation>();
  if (rows.length === 0) return out;
  const links = await readConflictLinks(tx);
  for (const r of rows) {
    out.set(r.passage_id, { confirmedBy: r.created_by, confirmedAt: r.created_at, status: confirmationStatus(r.passage_id, links) });
  }
  return out;
}

export function readConfirmations(db: Database, identityId: string | null): Promise<Map<string, PassageConfirmation>> {
  return db.withIdentity(identityId, readPassageConfirmations);
}

// 回答的引用標號的小標記（ADR 0013 決定 8）：引用到的段落中，目前已確認而且有效的（失效的不加）。依 cited 的順序、不重複
export function validConfirmed(cited: readonly string[], confirmations: ReadonlyMap<string, PassageConfirmation>): string[] {
  return [...new Set(cited)].filter((id) => confirmations.get(id)?.status.kind === "valid");
}

// 品質報告的確認比例（ADR 0013 決定 8）：passageIds 中目前身分看得到的段落，與其中已確認而且有效的段落（都經 RLS）
export function readConfirmationCoverage(db: Database, identityId: string | null, passageIds: readonly string[]): Promise<{ visible: string[]; confirmed: string[] }> {
  return db.withIdentity(identityId, async (tx) => {
    const ids = [...new Set(passageIds)];
    const visible = (await tx.query<{ id: string }>(`SELECT id FROM kk.passages WHERE id = ANY($1::text[]) ORDER BY id`, [ids])).rows.map((r) => r.id);
    return { visible, confirmed: validConfirmed(visible, await readPassageConfirmations(tx)) };
  });
}
