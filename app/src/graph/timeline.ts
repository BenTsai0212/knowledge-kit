// 時間軸：依日期由新到舊（#42）列出目前身分看得到的文件與段落，只列出介面語言的文件（#31 決定 2），可依實體篩選。
// 一律經 withIdentity()，權限交給 RLS；日期在 SQL 中轉成字串，不經過 JavaScript 的 Date（不受時區影響）。
import type { LanguageCode } from "../client/types";
import { readPassageMarks, type PassageMark } from "../conflicts/marks";
import type { Database } from "../db/database";

export interface TimelinePassage {
  id: string;
  content: string;
  // 以本段為出處的實體（只有看得到的）
  entityIds: string[];
  // 已處理的說法不同與取代（只有看得到另一段時才有）
  marks: PassageMark[];
}

export interface TimelineEntry {
  documentId: string;
  title: string;
  // YYYY-MM-DD；文件沒有日期時為 null，排在最後
  date: string | null;
  language: string;
  // 文件的可見等級與專案（畫面上的標籤）
  visibility: string;
  project: string | null;
  passages: TimelinePassage[];
}

export interface TimelineOptions {
  language: LanguageCode;
  // 只留以該實體為出處的段落，以及有這類段落的文件
  entityId?: string;
}

interface Row {
  document_id: string;
  title: string;
  date: string | null;
  language: string;
  visibility: string;
  project: string | null;
  passage_id: string;
  content: string;
  entity_ids: string[];
}

// 只列出有看得到的段落的文件；entity_sources 只回傳出處段落看得到的列
const SQL = `
  SELECT d.id AS document_id, d.title, to_char(d.document_date, 'YYYY-MM-DD') AS date, d.language,
         d.visibility_level_id AS visibility, d.project_id AS project,
         p.id AS passage_id, p.content,
         coalesce(array_agg(DISTINCT s.entity_id ORDER BY s.entity_id) FILTER (WHERE s.entity_id IS NOT NULL), '{}') AS entity_ids
    FROM kk.documents d
    JOIN kk.passages p ON p.document_id = d.id
    LEFT JOIN kk.entity_sources s ON s.passage_id = p.id
   WHERE d.language = $1
   GROUP BY d.id, p.id
   ORDER BY d.document_date DESC NULLS LAST, d.id, p.ordinal`;

export async function readTimeline(db: Database, identityId: string | null, options: TimelineOptions): Promise<TimelineEntry[]> {
  const [rows, marks] = await db.withIdentity(identityId, async (tx) => [(await tx.query<Row>(SQL, [options.language])).rows, await readPassageMarks(tx)] as const);
  const entries: TimelineEntry[] = [];
  for (const r of rows) {
    if (options.entityId !== undefined && !r.entity_ids.includes(options.entityId)) continue;
    let entry = entries.at(-1);
    if (entry?.documentId !== r.document_id) {
      entry = { documentId: r.document_id, title: r.title, date: r.date, language: r.language, visibility: r.visibility, project: r.project, passages: [] };
      entries.push(entry);
    }
    entry.passages.push({ id: r.passage_id, content: r.content, entityIds: r.entity_ids, marks: marks.get(r.passage_id) ?? [] });
  }
  return entries;
}
