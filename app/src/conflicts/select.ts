// 挑選要比對的段落（docs/conflicts.md「挑選段落」）：以上傳者的身分檢索每個新段落的相關既有段落，
// 依最相關的分數由高到低裝入，直到 prompt 的長度達到 PROMPT_CHAR_BUDGET。放不下的新段落記為未比對。
import type { ConflictsConfig, LanguageCode } from "../client/types";
import { PROMPT_CHAR_BUDGET, promptChars } from "../qa/prompt";
import type { RetrievedPassage, Retriever } from "../retrieval/retrieve";
import { conflictUserMessage, type PromptDocument } from "./prompt";

export interface ExistingPassage extends PromptDocument {
  id: string;
  documentId: string;
  content: string;
}

export interface ConflictSelection {
  // 送出的新段落 id，依文件中的順序；第 i 個是編號 i + 1
  newPassages: string[];
  // 送出的既有段落；第 i 個是編號 i + 1
  existing: ExistingPassage[];
  // 有相關的既有段落，但放不下而沒有比對的新段落
  unchecked: string[];
  // 沒有相關的既有段落、不需要比對的新段落
  unrelated: string[];
  // 沒有要送出的段落時為 null（不呼叫 /api/ask）
  user: string | null;
}

export interface SelectInput {
  uploader: string;
  documentId: string;
  document: PromptDocument;
  // 文件的語言：只比對同語言的既有段落
  language: LanguageCode;
  passages: { id: string; content: string }[];
  system: string;
}

export async function selectConflictPassages(
  retriever: Retriever,
  input: SelectInput,
  config: Pick<ConflictsConfig, "candidatesPerPassage" | "minScore">,
): Promise<ConflictSelection> {
  const candidates = new Map<string, RetrievedPassage[]>();
  for (const p of input.passages) {
    const found = await retriever.retrieve(input.uploader, p.content, {
      language: input.language,
      excludeDocument: input.documentId,
      topK: config.candidatesPerPassage,
      minScore: config.minScore,
    });
    candidates.set(p.id, found);
  }
  const order = new Map(input.passages.map((p, i) => [p.id, i]));
  const related = input.passages.filter((p) => candidates.get(p.id)!.length > 0);
  // 最相關的既有段落分數由高到低；同分時依文件中的順序（檢索結果已依分數排序）
  const ranked = [...related].sort((a, b) => candidates.get(b.id)![0].score - candidates.get(a.id)![0].score || order.get(a.id)! - order.get(b.id)!);

  const build = (chosen: typeof input.passages) => {
    const news = [...chosen].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const existing = new Map<string, ExistingPassage>();
    for (const p of chosen) {
      for (const c of candidates.get(p.id)!) {
        if (!existing.has(c.id)) existing.set(c.id, { id: c.id, documentId: c.documentId, title: c.documentTitle, date: c.documentDate, content: c.content });
      }
    }
    const list = [...existing.values()];
    return { news, existing: list, user: conflictUserMessage(input.document, news, list) };
  };

  let chosen: typeof input.passages = [];
  for (const p of ranked) {
    if (promptChars({ system: input.system, user: build([...chosen, p]).user }) > PROMPT_CHAR_BUDGET) break;
    chosen = [...chosen, p];
  }
  const taken = new Set(chosen.map((p) => p.id));
  const result = chosen.length > 0 ? build(chosen) : null;
  return {
    newPassages: result?.news.map((p) => p.id) ?? [],
    existing: result?.existing ?? [],
    unchecked: related.filter((p) => !taken.has(p.id)).map((p) => p.id),
    unrelated: input.passages.filter((p) => candidates.get(p.id)!.length === 0).map((p) => p.id),
    user: result?.user ?? null,
  };
}
