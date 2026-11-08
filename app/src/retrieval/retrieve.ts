// 檢索：依問題找出目前身分看得到的相關段落（docs/retrieval.md）。
// 段落一律經 withIdentity() 由 RLS 篩選後才計分；向量快取不影響可見範圍，只省去重算。
import type { RetrievalConfig } from "../client/types";
import type { Database } from "../db/database";
import { createProvider, type ActiveProvider } from "./providers";
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
  // 主管標記「新說法取代舊說法」時，取代這段的新段落；只在目前身分看得到新段落時才有（docs/conflicts.md「問答的取代」）
  supersededBy: SupersedingPassage | null;
}

// 取代舊段落的新段落。supersededBy 是取代它的段落 id（只有一層，不再展開）
export interface SupersedingPassage extends Omit<RetrievedPassage, "score" | "supersededBy"> {
  supersededBy: string | null;
}

// 個別呼叫的選項：只取某個語言的段落、排除某份文件，或改用不同的筆數與門檻（例如說法不同的比對，docs/conflicts.md）
export interface RetrieveOptions extends Partial<Pick<RetrievalConfig, "topK" | "minScore">> {
  language?: string;
  excludeDocument?: string;
}

export interface Retriever {
  retrieve(identityId: string | null, question: string, options?: RetrieveOptions): Promise<RetrievedPassage[]>;
}

interface SupersedeRow {
  old_id: string;
  id: string;
  document_id: string;
  document_title: string;
  document_date: string | null;
  language: string;
  content: string;
}

interface PassageRow {
  id: string;
  document_id: string;
  document_title: string;
  document_date: string | null;
  language: string;
  content: string;
}

type RetrievalOptions = Pick<RetrievalConfig, "topK" | "minScore">;

// provider 與參數可以是還在準備的 Promise（例如要先下載模型，降級時參數也跟著換）；建立 retriever 不等待，第一次檢索時才等它準備好
export function createRetriever(
  db: Database,
  provider: VectorProvider | Promise<VectorProvider>,
  options: RetrievalOptions | Promise<RetrievalOptions>,
): Retriever {
  const ready = Promise.all([provider, options]);
  // 準備失敗時由 retrieve() 拋出；在那之前不當成未處理的 rejection
  ready.catch(() => {});
  // 段落 id → 向量。段落內容在執行期間不變；之後會修改段落內容時，需在修改時清掉該段的快取
  const cache = new Map<string, unknown>();

  return {
    async retrieve(identityId, question, call = {}) {
      const { rows, supersede } = await db.withIdentity(identityId, async (tx) => ({
        // 段落不比所屬文件寬鬆，看得到段落就看得到文件，所以 JOIN 不會少掉段落（docs/retrieval.md）
        rows: (
          await tx.query<PassageRow>(
            `SELECT p.id, p.document_id, d.title AS document_title, to_char(d.document_date, 'YYYY-MM-DD') AS document_date, p.language, p.content
               FROM kk.passages p JOIN kk.documents d ON d.id = p.document_id
              WHERE ($1::text IS NULL OR p.language = $1) AND ($2::text IS NULL OR p.document_id <> $2)`,
            [call.language ?? null, call.excludeDocument ?? null],
          )
        ).rows,
        // 每個被取代的段落取一段新段落：文件日期最新的，日期相同時依段落 id。
        // 決定只在兩段都看得到時讀得到（RLS），看不到新段落的身分讀不到任何取代
        supersede: (
          await tx.query<SupersedeRow>(
            `SELECT DISTINCT ON (r.old_passage_id) r.old_passage_id AS old_id, n.id, n.document_id, nd.title AS document_title,
                    to_char(nd.document_date, 'YYYY-MM-DD') AS document_date, n.language, n.content
               FROM kk.conflict_decisions r
               JOIN kk.passages n ON n.id = r.new_passage_id JOIN kk.documents nd ON nd.id = n.document_id
              WHERE r.decision = 'supersede'
              ORDER BY r.old_passage_id, nd.document_date DESC NULLS LAST, n.id`,
          )
        ).rows,
      }));
      if (rows.length === 0) return [];

      const [vp, defaults] = await ready;
      const topK = call.topK ?? defaults.topK;
      const minScore = call.minScore ?? defaults.minScore;
      // 問題與段落分開轉換（語意模型對兩者的處理不同）；段落只算還沒在快取中的
      const [questionVector] = await vp.embed([question], "query");
      const missing = rows.filter((r) => !cache.has(r.id));
      if (missing.length > 0) {
        const vectors = await vp.embed(missing.map((r) => r.content), "passage");
        missing.forEach((r, i) => cache.set(r.id, vectors[i]));
      }

      const byOld = new Map(supersede.map((r) => [r.old_id, r]));
      const supersededBy = (id: string): SupersedingPassage | null => {
        const r = byOld.get(id);
        if (r === undefined) return null;
        return {
          id: r.id,
          documentId: r.document_id,
          documentTitle: r.document_title,
          documentDate: r.document_date,
          language: r.language,
          content: r.content,
          supersededBy: byOld.get(r.id)?.id ?? null,
        };
      };

      return rows
        .map((r) => ({
          id: r.id,
          documentId: r.document_id,
          documentTitle: r.document_title,
          documentDate: r.document_date,
          language: r.language,
          content: r.content,
          score: vp.similarity(questionVector, cache.get(r.id)),
        }))
        .filter((p) => p.score >= minScore)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, topK)
        .map((p) => ({ ...p, supersededBy: supersededBy(p.id) }));
    },
  };
}

// 依 client.json 的 retrieval 設定建立。App 與評測台傳入共用的 active，語意模型只下載、初始化一次
export function openRetriever(db: Database, config: RetrievalConfig, active: Promise<ActiveProvider> = createProvider(config)): Retriever {
  return createRetriever(
    db,
    active.then(({ provider }) => provider),
    active.then(({ options }) => options),
  );
}
