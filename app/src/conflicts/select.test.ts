import { describe, expect, it } from "vitest";
import { PROMPT_CHAR_BUDGET, promptChars } from "../qa/prompt";
import type { RetrievedPassage, RetrieveOptions, Retriever } from "../retrieval/retrieve";
import { selectConflictPassages, type SelectInput } from "./select";

const existing = (id: string, score: number, content = `${id} 的內容`): RetrievedPassage => ({
  id,
  documentId: `${id}-doc`,
  documentTitle: `${id} 的文件`,
  documentDate: "2026-05-15",
  language: "zh-TW",
  content,
  score,
});

// 依新段落的內容回傳固定的檢索結果，並記下呼叫
function fakeRetriever(results: Record<string, RetrievedPassage[]>) {
  const calls: { identityId: string | null; question: string; options?: RetrieveOptions }[] = [];
  const retriever: Retriever = {
    async retrieve(identityId, question, options) {
      calls.push({ identityId, question, options });
      return results[question] ?? [];
    },
  };
  return { retriever, calls };
}

const input = (passages: string[], system = "system"): SelectInput => ({
  uploader: "staff",
  documentId: "d-new",
  document: { title: "新文件", date: "2026-10-20" },
  language: "zh-TW",
  passages: passages.map((content, i) => ({ id: `n${i + 1}`, content })),
  system,
});
const CONFIG = { candidatesPerPassage: 2, minScore: 0.15 };

describe("selectConflictPassages", () => {
  it("以上傳者的身分檢索，限制文件語言、排除新文件，筆數與門檻依 conflicts 設定", async () => {
    const { retriever, calls } = fakeRetriever({});
    await selectConflictPassages(retriever, input(["甲"]), CONFIG);
    expect(calls).toEqual([{ identityId: "staff", question: "甲", options: { language: "zh-TW", excludeDocument: "d-new", topK: 2, minScore: 0.15 } }]);
  });

  it("沒有相關既有段落的新段落不送出；全部都沒有時不組 prompt", async () => {
    const { retriever } = fakeRetriever({});
    expect(await selectConflictPassages(retriever, input(["甲", "乙"]), CONFIG)).toEqual({
      newPassages: [],
      existing: [],
      unchecked: [],
      unrelated: ["n1", "n2"],
      user: null,
    });
  });

  it("新段落依文件中的順序編號，既有段落重複時只放一次", async () => {
    const { retriever } = fakeRetriever({ 甲: [existing("o1", 0.3)], 乙: [], 丙: [existing("o2", 0.9), existing("o1", 0.2)] });
    const result = await selectConflictPassages(retriever, input(["甲", "乙", "丙"]), CONFIG);
    expect(result.newPassages).toEqual(["n1", "n3"]);
    expect(result.existing.map((p) => p.id)).toEqual(["o2", "o1"]);
    expect(result.existing[0]).toEqual({ id: "o2", documentId: "o2-doc", title: "o2 的文件", date: "2026-05-15", content: "o2 的內容" });
    expect(result.unrelated).toEqual(["n2"]);
    expect(result.unchecked).toEqual([]);
    expect(result.user).toContain('<passage number="1">\n甲\n</passage>\n<passage number="2">\n丙\n</passage>');
  });

  it("超過 PROMPT_CHAR_BUDGET 時，分數低的新段落記為未比對", async () => {
    const long = (id: string, score: number) => existing(id, score, "測".repeat(3_000));
    const results = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`第 ${i + 1} 段`, [long(`o${i + 1}`, 0.2 + i * 0.05)]]),
    );
    const { retriever } = fakeRetriever(results);
    const system = "s".repeat(1_000);
    const result = await selectConflictPassages(retriever, input(Object.keys(results), system), CONFIG);
    expect(promptChars({ system, user: result.user! })).toBeLessThanOrEqual(PROMPT_CHAR_BUDGET);
    // 分數最高的是第 8 段；放不下的是分數較低的前幾段
    expect(result.newPassages.length).toBeGreaterThan(0);
    expect(result.newPassages).toContain("n8");
    expect(result.unchecked.length).toBe(8 - result.newPassages.length);
    expect(result.unchecked).toContain("n1");
    expect(result.unchecked).toEqual([...result.unchecked].sort());
  });
});
