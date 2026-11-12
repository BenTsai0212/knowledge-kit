// 首頁的「最近新增的文件」與「最近看過」的實體（#283，docs/design.md「日常工具」的「首頁」）。
// 一律經 withIdentity()，看得到哪些列完全交給 RLS（#247）；本模組不另外判斷權限。
import type { LanguageCode, LocalizedText } from "../client/types";
import type { Database } from "../db/database";

export interface RecentDocument {
  id: string;
  title: string;
  // YYYY-MM-DD；文件沒有日期時為 null
  date: string | null;
  visibility: string;
  project: string | null;
}

export interface RecentEntity {
  id: string;
  type: string;
  name: string;
  names: LocalizedText;
}

// 首頁「最近新增的文件」最多列出的筆數
export const RECENT_DOCUMENTS = 5;

// 與時間軸相同：只列介面語言、且有看得到的段落的文件（點了在時間軸打開）。
// 文件沒有新增時間：上傳的文件排在資料集之前，其次依文件日期由新到舊；日期在 SQL 中轉成字串（不受時區影響）
const DOCUMENTS_SQL = `
  SELECT d.id, d.title, to_char(d.document_date, 'YYYY-MM-DD') AS date, d.visibility_level_id AS visibility, d.project_id AS project
    FROM kk.documents d
   WHERE d.language = $1 AND EXISTS (SELECT 1 FROM kk.passages p WHERE p.document_id = d.id)
   ORDER BY d.uploaded_by IS NULL, d.document_date DESC NULLS LAST, d.id
   LIMIT $2`;

export function readRecentDocuments(db: Database, identityId: string | null, language: LanguageCode, limit = RECENT_DOCUMENTS): Promise<RecentDocument[]> {
  return db.withIdentity(identityId, async (tx) => (await tx.query<RecentDocument>(DOCUMENTS_SQL, [language, limit])).rows);
}

// 依 ids 的順序讀出目前身分看得到的實體；看不到的（例如撤回後，或換了身分）不回傳
export function readEntitiesByIds(db: Database, identityId: string | null, ids: readonly string[]): Promise<RecentEntity[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return db.withIdentity(identityId, async (tx) => {
    const rows = (
      await tx.query<{ id: string; entity_type: string; name: string; names: LocalizedText }>(
        "SELECT id, entity_type, name, names FROM kk.entities WHERE id = ANY($1::text[])",
        [[...ids]],
      )
    ).rows;
    const byId = new Map(rows.map((r) => [r.id, { id: r.id, type: r.entity_type, name: r.name, names: r.names }]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  });
}
