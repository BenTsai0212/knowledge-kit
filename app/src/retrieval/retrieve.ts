// 檢索：依問題找出目前身分看得到的相關段落（docs/retrieval.md）。
// 段落一律經 withIdentity() 由 RLS 篩選後才計分；向量快取不影響可見範圍，只省去重算。
import type { RetrievalConfig } from "../client/types";
import type { Database } from "../db/database";
import { createProvider } from "./providers";
import type { VectorProvider } from "./types";

export interface RetrievedPassage {
  id: string;
  documentId: string;
  language: string;
  content: string;
  score: number;
}

export interface Retriever {
  retrieve(identityId: string | null, question: string): Promise<RetrievedPassage[]>;
}

interface PassageRow {
  id: string;
  document_id: string;
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
    async retrieve(identityId, question) {
      const rows = await db.withIdentity(identityId, async (tx) =>
        (await tx.query<PassageRow>("SELECT id, document_id, language, content FROM kk.passages")).rows,
      );
      if (rows.length === 0) return [];

      const missing = rows.filter((r) => !cache.has(r.id));
      const [questionVector, ...vectors] = await provider.embed([question, ...missing.map((r) => r.content)]);
      missing.forEach((r, i) => cache.set(r.id, vectors[i]));

      return rows
        .map((r) => ({
          id: r.id,
          documentId: r.document_id,
          language: r.language,
          content: r.content,
          score: provider.similarity(questionVector, cache.get(r.id)),
        }))
        .filter((p) => p.score >= options.minScore)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, options.topK);
    },
  };
}

// 依 client.json 的 retrieval 設定建立
export function openRetriever(db: Database, config: RetrievalConfig): Retriever {
  return createRetriever(db, createProvider(config), config);
}
