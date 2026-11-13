// 引用跳回原文：讀取段落所屬的文件，以及其中目前身分看得到的段落。一律經 withIdentity()，權限交給 RLS。
// 看不到的段落直接省略，不標示「有段落被隱藏」，避免透露其存在。
import { readPassageMarks, type PassageMark } from "../conflicts/marks";
import type { Database } from "../db/database";

export interface SourceDocument {
  id: string;
  title: string;
  language: string;
  // 文件的可見等級與專案（畫面上的標籤）
  visibility: string;
  project: string | null;
  // marks：已處理的說法不同與取代（只有看得到另一段時才有）
  passages: { id: string; content: string; marks: PassageMark[] }[];
  // 被引用的段落 id
  highlight: string;
}

// 看不到該段落（或段落不存在）時回 null
export function readSource(db: Database, identityId: string | null, passageId: string): Promise<SourceDocument | null> {
  return db.withIdentity(identityId, async (tx) => {
    const doc = (
      await tx.query<{ id: string; title: string; language: string; visibility: string; project: string | null }>(
        `SELECT d.id, d.title, d.language, d.visibility_level_id AS visibility, d.project_id AS project
           FROM kk.passages p JOIN kk.documents d ON d.id = p.document_id WHERE p.id = $1`,
        [passageId],
      )
    ).rows[0];
    if (doc === undefined) return null;
    const passages = (
      await tx.query<{ id: string; content: string }>("SELECT id, content FROM kk.passages WHERE document_id = $1 ORDER BY ordinal", [doc.id])
    ).rows;
    const marks = await readPassageMarks(tx);
    return { ...doc, passages: passages.map((p) => ({ ...p, marks: marks.get(p.id) ?? [] })), highlight: passageId };
  });
}

// 桌機原文欄的「這次回答的出處」（#335）：一題回答引用到的段落，與手機「出處 N／M」相同的資料（cited，依第一次引用的順序、同一段一次）
export interface CitedSource {
  passageId: string;
  // 回答中的引用標號（numbering 中的位置＋1）
  citation: number;
  title: string;
  // 段落在文件中是這個身分看得到的第幾段（與原文欄的「¶N」相同）
  paragraph: number;
}

// 逐段以 readSource() 讀取，權限同樣交給 RLS；之後看不到的段落（例如被撤回）不列出
export async function readCitedSources(db: Database, identityId: string | null, numbering: readonly string[], cited: readonly string[]): Promise<CitedSource[]> {
  const items: CitedSource[] = [];
  for (const passageId of new Set(cited)) {
    const doc = await readSource(db, identityId, passageId);
    if (doc === null) continue;
    items.push({ passageId, citation: numbering.indexOf(passageId) + 1, title: doc.title, paragraph: doc.passages.findIndex((p) => p.id === passageId) + 1 });
  }
  return items;
}
