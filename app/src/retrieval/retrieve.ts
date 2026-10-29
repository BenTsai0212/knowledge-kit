// 檢索：依問題找出目前身分看得到的相關段落（docs/retrieval.md）。
// 段落一律經 withIdentity() 由 RLS 篩選後才計分；向量快取不影響可見範圍，只省去重算。
import type { RetrievalConfig } from "../client/types";
import type { Database } from "../db/database";
import { createProvider } from "./providers";
import type { VectorProvider } from "./types";

export interface RetrievedPassage {
  id: string;
  documentId: string;
  documentTitle: string;
  // 文件日期（YYYY-MM-DD）；沒有日期時為 null
  documentDate: string | null;
  language: string;
  content: string;
  score: number;
}

// 個別呼叫的選項：只取某個語言的段落、排除某份文件，或改用不同的筆數與門檻（例如說法不同的比對，docs/conflicts.md）
export interface RetrieveOptions extends Partial<Pick<RetrievalConfig, "topK" | "minScore">> {
  language?: string;
  excludeDocument?: string;
}

export interface Retriever {
  retrieve(identityId: string | null, question: string, options?: RetrieveOptions): Promise<RetrievedPassage[]>;
}

interface PassageRow {
  id: string;
  document_id: string;
  document_title: string;
  document_date: string | null;
  language: string;
  content: string;
}

export function createRetriever(
  db: Database,
  provider: VectorProvider,
  options: Pick<RetrievalConfig, "topK" | "minScore">,
): Retriever {
  // 段落 id → 向量。段落內容在執行期間不變；之後會修改段落內容時，需在修改時清掉該段的快取
  const cache = new Map<string, unknown>();

  return {
    async retrieve(identityId, question, call = {}) {
      const topK = call.topK ?? options.topK;
      const minScore = call.minScore ?? options.minScore;
      const rows = await db.withIdentity(identityId, async (tx) =>
        // 段落不比所屬文件寬鬆，看得到段落就看得到文件，所以 JOIN 不會少掉段落（docs/retrieval.md）
        (
          await tx.query<PassageRow>(
            `SELECT p.id, p.document_id, d.title AS document_title, to_char(d.document_date, 'YYYY-MM-DD') AS document_date, p.language, p.content
               FROM kk.passages p JOIN kk.documents d ON d.id = p.document_id
              WHERE ($1::text IS NULL OR p.language = $1) AND ($2::text IS NULL OR p.document_id <> $2)`,
            [call.language ?? null, call.excludeDocument ?? null],
          )
        ).rows,
      );
      if (rows.length === 0) return [];

      const missing = rows.filter((r) => !cache.has(r.id));
      const [questionVector, ...vectors] = await provider.embed([question, ...missing.map((r) => r.content)]);
      missing.forEach((r, i) => cache.set(r.id, vectors[i]));

      return rows
        .map((r) => ({
          id: r.id,
          documentId: r.document_id,
          documentTitle: r.document_title,
          documentDate: r.document_date,
          language: r.language,
          content: r.content,
          score: provider.similarity(questionVector, cache.get(r.id)),
        }))
        .filter((p) => p.score >= minScore)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, topK);
    },
  };
}

// 依 client.json 的 retrieval 設定建立
export function openRetriever(db: Database, config: RetrievalConfig): Retriever {
  return createRetriever(db, createProvider(config), config);
}
