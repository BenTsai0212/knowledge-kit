// 問答的權限滲漏：送到 /api/ask 的內容只包含該身分看得到的段落與文件標題（以 oracle.ts 比對）。
// 段落在 prompt 中會跳脫，所以以 escapeText() 後的文字比對 body（#26 決定）。
// 只檢查 <passages> 區段：查詢本身可能就是看不到的段落文字，出現在 <question> 中不算滲漏。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAskBody } from "../../../worker/src/request";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { ask, type QaContext } from "../../src/qa/answer";
import { escapeText, PROMPT_CHAR_BUDGET, promptChars } from "../../src/qa/prompt";
import { fakeTransport } from "../../src/qa/testing";
import type { AskBody } from "../../src/qa/types";
import { openRetriever } from "../../src/retrieval/retrieve";
import { expectedVisible } from "../db/oracle";
import type { Sample } from "../db/sample";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];

const documents = Object.values(dataset.documents);
const passages = documents.flatMap((d) => d.passages.map((p) => ({ ...p, doc: d })));
const sample: Sample = {
  docs: documents.map((d) => ({ id: d.id, level: d.visibility, project: d.project ?? null })),
  passages: passages.map((p) => ({
    id: p.id,
    doc: p.doc.id,
    level: p.visibility ?? p.doc.visibility,
    project: p.project ?? p.doc.project ?? null,
  })),
  entities: dataset.entities.entities.map((e) => ({ id: e.id, sources: e.sources })),
  relations: dataset.relations.relations.map((r) => ({ id: r.id, from: r.from, to: r.to, sources: r.sources })),
};
const visible = (id: string | null) => {
  const v = expectedVisible(access, sample, id);
  return { passages: new Set(v.passages), documents: new Set(v.documents) };
};

const QUERIES = [
  ...clientConfig.scenarios.scenarios.flatMap((s) => s.questions.flatMap((q) => Object.values(q.text))),
  ...passages.map((p) => p.text),
];

let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

const passagesSection = (body: AskBody) => {
  const content = body.messages[0].content;
  // 內容都已跳脫，第一個 </passages> 就是區段的結尾
  return content.slice(content.indexOf("<passages>"), content.indexOf("</passages>"));
};

// 以 db 檢索、逐一提問，回傳每個 body 中不該出現的段落與文件標題
async function leaks(database: Database, identities = IDENTITIES) {
  const found: string[] = [];
  const bodies: AskBody[] = [];
  for (const id of identities) {
    const allowed = visible(id);
    const transport = fakeTransport();
    const ctx: QaContext = {
      retriever: openRetriever(database, clientConfig.client.retrieval),
      transport,
      model: clientConfig.client.model,
      displayName: clientConfig.client.displayName,
    };
    for (const language of clientConfig.client.languages) {
      for (const q of QUERIES) await ask(ctx, { identityId: id, text: q, language });
    }
    for (const body of transport.bodies) {
      const section = passagesSection(body);
      for (const p of passages) if (!allowed.passages.has(p.id) && section.includes(escapeText(p.text))) found.push(`${id}：段落 ${p.id}`);
      for (const d of documents) {
        if (!allowed.documents.has(d.id) && section.includes(`title="${escapeText(d.title)}"`)) found.push(`${id}：文件 ${d.id}`);
      }
    }
    bodies.push(...transport.bodies);
  }
  return { found, bodies };
}

describe("問答的權限滲漏", () => {
  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    const { found } = await leaks(ignoring, ["guest"]);
    expect(found.some((f) => f.includes("段落"))).toBe(true);
    expect(found.some((f) => f.includes("文件"))).toBe(true);
  });

  it("每個身分 × 每種介面語言 × 每個查詢：送出的段落與文件標題滲漏 0", async () => {
    const { found, bodies } = await leaks(db);
    console.log(`問答權限滲漏 ${found.length}（${IDENTITIES.length} 個身分 × ${QUERIES.length} 個查詢 × 2 種語言，送出 ${bodies.length} 次）`);
    expect(found).toEqual([]);
    expect(bodies.length).toBeGreaterThan(0);
  });

  it("以看得到的段落本身的文字提問時，該段落會送出（防止以什麼都沒送而通過）", async () => {
    for (const p of passages) {
      const role = ["guest", "staff", "manager"].find((r) => visible(r).passages.has(p.id))!;
      const transport = fakeTransport();
      const ctx: QaContext = {
        retriever: openRetriever(db, clientConfig.client.retrieval),
        transport,
        model: clientConfig.client.model,
        displayName: clientConfig.client.displayName,
      };
      await ask(ctx, { identityId: role, text: p.text, language: p.language ?? p.doc.language });
      expect(passagesSection(transport.bodies[0]), p.id).toContain(escapeText(p.text));
      expect(passagesSection(transport.bodies[0]), p.id).toContain(`title="${escapeText(p.doc.title)}"`);
    }
  });

  it("每次送出都在 PROMPT_CHAR_BUDGET 內，且長度算法與 Worker 相同", async () => {
    const { bodies } = await leaks(db, ["manager"]);
    for (const body of bodies) {
      const parsed = parseAskBody(body, PROMPT_CHAR_BUDGET);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.promptChars).toBe(promptChars({ system: body.system, user: body.messages[0].content }));
    }
  });
});
