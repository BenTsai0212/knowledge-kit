// 回答錯誤回報的資料層（ADR 0007 決定 7，docs/data-model.md「回答錯誤回報」）：寫入、讀取、處理。
// 一律經 withIdentity()；誰能寫入、看得到、處理什麼，完全交給 RLS（migration 0010）。只用 INSERT。
import type { Database } from "../db/database";
import { ReviewError } from "../extraction/store";

// 原因類別（#209 決定 4）。拒答的回報預設選 should_answer
export const REPORT_CATEGORIES = ["wrong_fact", "wrong_citation", "missing", "should_refuse", "should_answer", "other"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export type ReportResolution = "not_error" | "retracted";

// 說明的字數上限（migration 0010 的 CHECK）；畫面的輸入框以此限制
export const MAX_REPORT_NOTE_CHARS = 1000;

export interface NewReport {
  category: ReportCategory;
  // 選填說明；空白視為沒有
  note: string | null;
  question: string;
  // 拒答時為 null：回報只含問題文字
  answer: {
    text: string;
    // 送給模型的所有段落（Answer 的 numbering）
    sent: readonly string[];
    // 回答引用的段落，必須是 sent 的子集
    cited: readonly string[];
    // 回答提到的實體
    entities: readonly string[];
  } | null;
}

export interface AnswerReport {
  id: string;
  reportedBy: string;
  reportedAt: string;
  category: ReportCategory;
  note: string | null;
  question: string;
  answer: string | null;
  sentPassageIds: string[];
  citedPassageIds: string[];
  // 只列出目前身分看得到的實體
  entityIds: string[];
  // 尚未處理時為 null
  resolution: ReportResolution | null;
}

export const newReportId = () => `ar-${crypto.randomUUID()}`;

// 42501：被 RLS 拒絕；23502：沒有身分（回報者或處理者為 NULL）；23503：外鍵（不存在的身分或回報）；
// 23514：違反 CHECK（類別、長度、引用不在送出的段落中）；23505：已處理。資料庫的訊息不顯示在畫面上
function mapError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === "42501" || code === "23502" || code === "23503" || code === "23514") throw new ReviewError("denied");
  if (code === "23505") throw new ReviewError("conflict");
  throw e;
}

// 寫入回報，回傳 id。沒有 canReview 的回報者讀不到自己寫的回報，所以不使用 RETURNING
export async function writeReport(db: Database, identityId: string | null, report: NewReport): Promise<string> {
  const id = newReportId();
  const note = report.note?.trim() || null;
  const a = report.answer;
  try {
    await db.withIdentity(identityId, (tx) =>
      tx.query(
        `INSERT INTO kk.answer_reports (id, reported_by, category, note, question, answer, sent_passage_ids, cited_passage_ids, entity_ids)
         VALUES ($1, kk.current_identity_id(), $2, $3, $4, $5, $6, $7, $8)`,
        [id, report.category, note, report.question, a?.text ?? null, [...(a?.sent ?? [])], [...(a?.cited ?? [])], [...new Set(a?.entities ?? [])]],
      ),
    );
  } catch (e) {
    mapError(e);
  }
  return id;
}

// 目前身分看得到的回報（有 canReview，且送出的段落全部看得到），新的在前
export function readReports(db: Database, identityId: string | null): Promise<AnswerReport[]> {
  return db.withIdentity(identityId, async (tx) => {
    const rows = (
      await tx.query<{
        id: string;
        reported_by: string;
        reported_at: string;
        category: ReportCategory;
        note: string | null;
        question: string;
        answer: string | null;
        sent_passage_ids: string[];
        cited_passage_ids: string[];
        entity_ids: string[];
        resolution: ReportResolution | null;
      }>(
        `SELECT r.id, r.reported_by, to_char(r.reported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS reported_at,
                r.category, r.note, r.question, r.answer, r.sent_passage_ids, r.cited_passage_ids,
                coalesce(ARRAY(SELECT e.id FROM unnest(r.entity_ids) WITH ORDINALITY AS x (id, n) JOIN kk.entities e ON e.id = x.id ORDER BY x.n), '{}') AS entity_ids,
                s.resolution
           FROM kk.answer_reports r
           LEFT JOIN kk.answer_report_resolutions s ON s.report_id = r.id
          ORDER BY r.reported_at DESC, r.id`,
      )
    ).rows;
    return rows.map((r) => ({
      id: r.id,
      reportedBy: r.reported_by,
      reportedAt: r.reported_at,
      category: r.category,
      note: r.note,
      question: r.question,
      answer: r.answer,
      sentPassageIds: r.sent_passage_ids,
      citedPassageIds: r.cited_passage_ids,
      entityIds: r.entity_ids,
      resolution: r.resolution,
    }));
  });
}

// 處理一個回報：「不是錯誤」，或已在原文、圖譜撤回。看不到該回報、沒有 canReview 時拒絕；已處理時是 conflict
export async function resolveReport(db: Database, identityId: string | null, reportId: string, resolution: ReportResolution): Promise<void> {
  try {
    await db.withIdentity(identityId, (tx) =>
      tx.query("INSERT INTO kk.answer_report_resolutions (report_id, resolution, resolved_by) VALUES ($1, $2, kk.current_identity_id())", [
        reportId,
        resolution,
      ]),
    );
  } catch (e) {
    mapError(e);
  }
}
