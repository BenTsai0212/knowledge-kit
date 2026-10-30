// 評測的滲漏判定（docs/evals.md「權限滲漏」）：以題庫的每一題、題庫指定的角色經 withIdentity() 執行 ask()，
// 一般資料層的滲漏為 0；反向驗證：忽略身分、一律以主管查詢的資料層會被判定為滲漏（#62 驗收條件）。
// 測試只使用假的 /api/ask（fakeTransport），不呼叫真實 API。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { evalQuestions } from "../../src/evals/load";
import { leakContext, scoreQuestion, type QuestionScore } from "../../src/evals/score";
import type { EvalQuestion } from "../../src/evals/types";
import { ask, type QaContext } from "../../src/qa/answer";
import { answered, fakeTransport } from "../../src/qa/testing";
import type { AskBody, AskEvent } from "../../src/qa/types";
import { openRetriever, type Retriever } from "../../src/retrieval/retrieve";

const questions = evalQuestions.questions;
let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

// 執行一題並評分：在 Retriever 外包一層記下檢索結果，transport 記下送出的 body
async function run(database: Database, q: EvalQuestion, reply?: (body: AskBody) => AskEvent[]): Promise<QuestionScore> {
  const retrieved: string[] = [];
  const inner = openRetriever(database, clientConfig.client.retrieval);
  const retriever: Retriever = {
    async retrieve(identityId, text, options) {
      const out = await inner.retrieve(identityId, text, options);
      retrieved.push(...out.map((p) => p.id));
      return out;
    },
  };
  const transport = fakeTransport(reply);
  const ctx: QaContext = { retriever, transport, model: clientConfig.client.model, displayName: clientConfig.client.displayName };
  const answer = await ask(ctx, { identityId: q.role, text: q.question, language: q.language });
  return scoreQuestion(q, { retrieved, bodies: transport.bodies, answer }, leakContext(clientConfig.access, dataset, q.role));
}

describe("評測的滲漏判定", () => {
  it("題庫的每一題：一般資料層的滲漏為 0", async () => {
    const leaks: string[] = [];
    let sent = 0;
    for (const q of questions) {
      const score = await run(db, q);
      leaks.push(...score.leaks.map((l) => `${q.id}：${JSON.stringify(l)}`));
      if (score.outcome !== "refusal") sent++;
    }
    expect(leaks).toEqual([]);
    // 防止以什麼都沒送而通過
    expect(sent).toBeGreaterThan(0);
  });

  it("反向驗證：忽略身分、一律以主管查詢的資料層，權限題會被判定為滲漏", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    const permission = questions.filter((q) => q.category === "permission" && q.expect === "refusal");
    expect(permission.length).toBeGreaterThan(0);
    for (const q of permission) {
      const score = await run(ignoring, q);
      const kinds = new Set(score.leaks.map((l) => l.kind));
      expect(kinds.has("retrieved"), q.id).toBe(true);
      expect(kinds.has("sentPassage"), q.id).toBe(true);
    }
  });

  it("回答提到禁止內容時判定為滲漏", async () => {
    const q = questions.find((q) => q.id === "bluewing-cost-staff")!;
    const score = await run(db, q, () => answered("成本約 8500 元 [1]"));
    expect(score.leaks).toContainEqual({ kind: "forbidden", term: "8500" });
    expect(score.refused).toBe(false);
  });
});
