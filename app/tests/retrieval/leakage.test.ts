// 檢索的權限滲漏：以參考資料集，對每個身分、每個查詢，比對檢索結果與 oracle.ts 的預期可見段落。
// 查詢包含預設問題與每一段段落本身的文字（最容易命中看不到的段落）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { keywordHashProvider } from "../../src/retrieval/keyword-hash";
import { createRetriever, openRetriever, type Retriever } from "../../src/retrieval/retrieve";
import { expectedVisible } from "../db/oracle";
import type { Sample } from "../db/sample";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];

// 參考資料集轉成 oracle.ts 的形狀；段落省略的等級與專案沿用文件（docs/dataset.md）
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

// 回傳每個身分的滲漏段落（查得到但不該看到）
async function leaks(retriever: Retriever, identities = IDENTITIES) {
  const found: string[] = [];
  for (const id of identities) {
    const allowed = visible(id);
    for (const q of QUERIES) {
      for (const r of await retriever.retrieve(id, q)) if (!allowed.has(r.id)) found.push(`${id}：${r.id}`);
    }
  }
  return found;
}

describe("檢索的權限滲漏", { timeout: 30_000 }, () => {
  it("資料集確實區分各身分（防止資料太少而通過）", () => {
    const [g, s, m] = ["guest", "staff", "manager"].map((id) => visible(id).size);
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(s);
    expect(s).toBeLessThan(m);
    expect(m).toBe(sample.passages.length);
  });

  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    const found = await leaks(openRetriever(ignoring, clientConfig.client.retrieval), ["guest"]);
    expect(found.length).toBeGreaterThan(0);
  });

  it("預設設定：每個身分 × 每個查詢，滲漏 0", async () => {
    const found = await leaks(openRetriever(db, clientConfig.client.retrieval));
    console.log(`檢索權限滲漏 ${found.length}（${IDENTITIES.length} 個身分 × ${QUERIES.length} 個查詢）`);
    expect(found).toEqual([]);
  });

  it("不限名次與門檻時，結果正好是該身分看得到的段落（滲漏 0、漏看 0）", async () => {
    const retriever = createRetriever(db, keywordHashProvider, { topK: sample.passages.length, minScore: 0 });
    for (const id of IDENTITIES) {
      const ids = (await retriever.retrieve(id, "專案")).map((r) => r.id).sort();
      expect(ids, String(id)).toEqual([...visible(id)].sort());
    }
  });

  it("以看得到的段落本身的文字查詢時，該段是第 1 名（防止以空結果通過）", async () => {
    const retriever = openRetriever(db, clientConfig.client.retrieval);
    for (const p of documents.flatMap((d) => d.passages)) {
      const role = visible("guest").has(p.id) ? "guest" : visible("staff").has(p.id) ? "staff" : "manager";
      expect((await retriever.retrieve(role, p.text))[0]?.id, p.id).toBe(p.id);
    }
  });

  it("同一個 retriever 交替檢索不同身分，快取不造成滲漏", async () => {
    const retriever = openRetriever(db, clientConfig.client.retrieval);
    expect(await leaks(retriever, ["manager", "guest", "staff", "manager", "guest", null])).toEqual([]);
  });
});
