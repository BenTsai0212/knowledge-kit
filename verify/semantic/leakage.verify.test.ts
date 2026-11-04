// #126 換 provider 的權限滲漏（verify 分支專用）：app/tests/retrieval/leakage.test.ts 與 app/tests/evals/leakage.test.ts
// 的同一套檢查，Retriever 改用候選模型。必須是 0；反向驗證（忽略身分的資料層）必須抓得到。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../app/src/client/load";
import { dataset } from "../../app/src/dataset/load";
import { seedDataset } from "../../app/src/dataset/seed";
import { openDatabase, type Database } from "../../app/src/db/database";
import { evalQuestions } from "../../app/src/evals/load";
import { leakContext, scoreQuestion } from "../../app/src/evals/score";
import type { EvalQuestion } from "../../app/src/evals/types";
import { ask } from "../../app/src/qa/answer";
import { fakeTransport } from "../../app/src/qa/testing";
import { createRetriever, type Retriever } from "../../app/src/retrieval/retrieve";
import { expectedVisible } from "../../app/tests/db/oracle";
import type { Sample } from "../../app/tests/db/sample";
import { createSemanticProvider, type CandidateKey, type SemanticProvider } from "./provider";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];
const documents = Object.values(dataset.documents);
const sample: Sample = {
  docs: documents.map((d) => ({ id: d.id, level: d.visibility, project: d.project ?? null })),
  passages: documents.flatMap((d) =>
    d.passages.map((p) => ({ id: p.id, doc: d.id, level: p.visibility ?? d.visibility, project: p.project ?? d.project ?? null })),
  ),
  entities: dataset.entities.entities.map((e) => ({ id: e.id, sources: e.sources })),
  relations: dataset.relations.relations.map((r) => ({ id: r.id, from: r.from, to: r.to, sources: r.sources })),
};
const visible = (id: string | null) => new Set(expectedVisible(access, sample, id).passages);
const QUERIES = [
  ...clientConfig.scenarios.scenarios.flatMap((s) => s.questions.flatMap((q) => Object.values(q.text))),
  ...documents.flatMap((d) => d.passages.map((p) => p.text)),
];

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

async function leaks(retriever: Retriever, identities = IDENTITIES) {
  const found: string[] = [];
  for (const id of identities) {
    const allowed = visible(id);
    for (const q of QUERIES) for (const r of await retriever.retrieve(id, q)) if (!allowed.has(r.id)) found.push(`${id}：${r.id}`);
  }
  return found;
}

async function evalLeaks(database: Database, provider: SemanticProvider, q: EvalQuestion) {
  const retrieved: string[] = [];
  const inner = createRetriever(database, provider, clientConfig.client.retrieval);
  const retriever: Retriever = {
    async retrieve(identityId, text, options) {
      const out = await inner.retrieve(identityId, text, options);
      retrieved.push(...out.map((p) => p.id));
      return out;
    },
  };
  const transport = fakeTransport();
  const answer = await ask(
    { retriever, transport, model: clientConfig.client.model, displayName: clientConfig.client.displayName },
    { identityId: q.role, text: q.question, language: q.language },
  );
  return scoreQuestion(q, { retrieved, bodies: transport.bodies, answer }, leakContext(access, dataset, q.role));
}

describe.each(["A1", "A2"] as CandidateKey[])("%s 的權限滲漏", { timeout: 600_000 }, (key) => {
  let provider: SemanticProvider;
  beforeAll(async () => {
    provider = await createSemanticProvider(key);
  });

  it("檢索：每個身分 × 每個查詢，預設設定與不限名次、門檻 0 都是滲漏 0", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    expect((await leaks(createRetriever(ignoring, provider, clientConfig.client.retrieval), ["guest"])).length).toBeGreaterThan(0);
    const found = [
      ...(await leaks(createRetriever(db, provider, clientConfig.client.retrieval))),
      ...(await leaks(createRetriever(db, provider, { topK: sample.passages.length, minScore: 0 }))),
    ];
    console.log(`${key} 檢索權限滲漏 ${found.length}（${IDENTITIES.length} 個身分 × ${QUERIES.length} 個查詢 × 2 種設定）`);
    expect(found).toEqual([]);
  });

  it("評測：題庫的每一題滲漏 0；忽略身分的資料層，權限拒答題會被判定為滲漏", async () => {
    const found: string[] = [];
    for (const q of evalQuestions.questions) found.push(...(await evalLeaks(db, provider, q)).leaks.map((l) => `${q.id}：${JSON.stringify(l)}`));
    console.log(`${key} 評測滲漏 ${found.length}（${evalQuestions.questions.length} 題）`);
    expect(found).toEqual([]);
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    for (const q of evalQuestions.questions.filter((q) => q.category === "permission" && q.expect === "refusal")) {
      expect((await evalLeaks(ignoring, provider, q)).leaks.some((l) => l.kind === "retrieved"), q.id).toBe(true);
    }
  });
});
