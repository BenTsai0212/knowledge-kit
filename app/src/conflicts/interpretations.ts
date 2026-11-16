// 人的理解的資料層（ADR 0012 決定 5、6，docs/data-model.md「人的理解」）：寫入、讀取。
// 一律經 withIdentity()；誰能寫入、看得到什麼，完全交給 RLS（migration 0015）。只用 INSERT。
import type { Database } from "../db/database";
import { ReviewError } from "../extraction/store";

// 「都不是，我來說明」的選擇；只有這時可以附說明
export const OTHER_CHOICE = "other";
// 選擇與說明的字數上限（migration 0015 的 CHECK）
export const MAX_CHOICE_CHARS = 100;
export const MAX_INTERPRETATION_NOTE_CHARS = 500;

export interface NewInterpretation {
  // 一組說法不同的兩段，順序不拘
  passages: readonly [string, string];
  // 選的假設的文字（或固定範本的選項），或 OTHER_CHOICE
  choice: string;
  // AI 提出另一種可能後是否改了選擇
  changedAfterChallenge: boolean;
  // 選填說明，只用於 OTHER_CHOICE；空白視為沒有
  note: string | null;
}

export interface Interpretation {
  id: string;
  // 兩段的 id，依資料庫的順序（passageA < passageB）
  passageA: string;
  passageB: string;
  choice: string;
  changedAfterChallenge: boolean;
  note: string | null;
  // 作者的身分 id（角色層級，畫面只顯示角色與時間）
  createdBy: string;
  createdAt: string;
  // 作者是目前身分
  mine: boolean;
}

export const newInterpretationId = () => `in-${crypto.randomUUID()}`;

// 與 PostgreSQL 的 char_length() 一樣以字元（code point）計算
const chars = (s: string) => [...s].length;

// 42501：被 RLS 拒絕；23502：沒有身分；23503：外鍵（不存在的段落或身分）；
// 23514：違反 CHECK（同一段、長度、說明不是 other）；23505：同一個身分已對這一組留下理解。資料庫的訊息不顯示在畫面上
function mapError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === "42501" || code === "23502" || code === "23503" || code === "23514") throw new ReviewError("denied");
  if (code === "23505") throw new ReviewError("conflict");
  throw e;
}

// 留下理解，回傳 id。兩段由資料庫排序（LEAST、GREATEST，與 CHECK 用同一個 collation）。看不到其中一段、沒有身分時拒絕；同一個身分對同一組第二次寫入是 conflict
export async function writeInterpretation(db: Database, identityId: string | null, x: NewInterpretation): Promise<string> {
  const [a, b] = x.passages;
  const note = x.note?.trim() || null;
  if (chars(x.choice) > MAX_CHOICE_CHARS || (note !== null && chars(note) > MAX_INTERPRETATION_NOTE_CHARS)) throw new ReviewError("denied");
  const id = newInterpretationId();
  try {
    await db.withIdentity(identityId, (tx) =>
      tx.query(
        `INSERT INTO kk.interpretations (id, passage_a, passage_b, choice, changed_after_challenge, note, created_by)
         VALUES ($1, LEAST($2::text, $3::text), GREATEST($2::text, $3::text), $4, $5, $6, kk.current_identity_id())`,
        [id, a, b, x.choice, x.changedAfterChallenge, note],
      ),
    );
  } catch (e) {
    mapError(e);
  }
  return id;
}

// 目前身分看得到的理解（兩段都看得到），舊的在前。指定兩段時只讀那一組。
// 「先作答才看得到同事的理解」由畫面依 mine 判斷（ADR 0012 決定 6）
export function readInterpretations(db: Database, identityId: string | null, passages?: readonly [string, string]): Promise<Interpretation[]> {
  return db.withIdentity(identityId, async (tx) => {
    const rows = (
      await tx.query<{
        id: string;
        passage_a: string;
        passage_b: string;
        choice: string;
        changed_after_challenge: boolean;
        note: string | null;
        created_by: string;
        created_at: string;
        mine: boolean;
      }>(
        `SELECT id, passage_a, passage_b, choice, changed_after_challenge, note, created_by,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                created_by = kk.current_identity_id() AS mine
           FROM kk.interpretations i
          WHERE $1::text IS NULL OR (passage_a = LEAST($1::text, $2::text) AND passage_b = GREATEST($1::text, $2::text))
          ORDER BY i.created_at, i.id`,
        [passages?.[0] ?? null, passages?.[1] ?? null],
      )
    ).rows;
    return rows.map((r) => ({
      id: r.id,
      passageA: r.passage_a,
      passageB: r.passage_b,
      choice: r.choice,
      changedAfterChallenge: r.changed_after_challenge,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at,
      mine: r.mine,
    }));
  });
}
