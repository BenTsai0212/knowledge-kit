// 時間軸與原文面板的標示（docs/conflicts.md「畫面」）：已處理為「並存」「取代」的組合，每段指向另一段。
// 在呼叫端的 withIdentity() 交易中讀取；RLS 只讓兩段都看得到的決定被讀到，所以看不到另一段的身分沒有任何標示。
import type { Transaction } from "@electric-sql/pglite";

// conflict：並存（兩段都標示）；superseded_by：舊段落被取代；supersedes：新段落取代了舊段落
export type PassageMarkKind = "conflict" | "superseded_by" | "supersedes";

export interface PassageMark {
  kind: PassageMarkKind;
  // 另一段與它所屬的文件
  passageId: string;
  documentId: string;
  documentTitle: string;
}

interface Row {
  decision: "coexist" | "supersede";
  new_id: string;
  new_document: string;
  new_title: string;
  old_id: string;
  old_document: string;
  old_title: string;
}

// 新段落依文件日期由新到舊（沒有日期的最舊），日期相同時依段落 id：同一段被多段取代時，第一筆就是要顯示的（#51 決定 4）
const SQL = `
  SELECT r.decision, n.id AS new_id, nd.id AS new_document, nd.title AS new_title, o.id AS old_id, od.id AS old_document, od.title AS old_title
    FROM kk.conflict_decisions r
    JOIN kk.passages n ON n.id = r.new_passage_id JOIN kk.documents nd ON nd.id = n.document_id
    JOIN kk.passages o ON o.id = r.old_passage_id JOIN kk.documents od ON od.id = o.document_id
   WHERE r.decision IN ('coexist', 'supersede')
   ORDER BY nd.document_date DESC NULLS LAST, n.id, o.id`;

// 段落 id → 標示。被取代的段落只標示一個取代者；並存與「取代了」全部標示
export async function readPassageMarks(tx: Transaction): Promise<Map<string, PassageMark[]>> {
  const marks = new Map<string, PassageMark[]>();
  const add = (id: string, mark: PassageMark) => marks.set(id, [...(marks.get(id) ?? []), mark]);
  const superseded = new Set<string>();
  for (const r of (await tx.query<Row>(SQL)).rows) {
    const toNew = { passageId: r.new_id, documentId: r.new_document, documentTitle: r.new_title };
    const toOld = { passageId: r.old_id, documentId: r.old_document, documentTitle: r.old_title };
    if (r.decision === "coexist") {
      add(r.old_id, { kind: "conflict", ...toNew });
      add(r.new_id, { kind: "conflict", ...toOld });
      continue;
    }
    add(r.new_id, { kind: "supersedes", ...toOld });
    if (superseded.has(r.old_id)) continue;
    superseded.add(r.old_id);
    add(r.old_id, { kind: "superseded_by", ...toNew });
  }
  return marks;
}

// 桌機回答卡片的說法不同提示（#335）：同一題引用到的段落中，兩段都被引用、且已處理為「並存」的組合。
// 回傳兩段的引用標號（numbering 中的位置＋1），小的在前，依標號排序。marks 是送出身分的 readPassageMarks()，所以只有兩段都看得到時才有
export function citedConflicts(numbering: readonly string[], cited: readonly string[], marks: ReadonlyMap<string, readonly PassageMark[]>): Array<[number, number]> {
  const citedSet = new Set(cited);
  const pairs = new Map<string, [number, number]>();
  for (const id of citedSet) {
    for (const m of marks.get(id) ?? []) {
      if (m.kind !== "conflict" || !citedSet.has(m.passageId)) continue;
      const a = numbering.indexOf(id) + 1;
      const b = numbering.indexOf(m.passageId) + 1;
      if (a === 0 || b === 0 || a === b) continue;
      const pair: [number, number] = a < b ? [a, b] : [b, a];
      pairs.set(pair.join(","), pair);
    }
  }
  return [...pairs.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}
