// 身分對照的權限滲漏（#261）：同一題以每個身分各送出一次時，每一欄送出的段落、文件標題與引用都只屬於該欄身分看得到的範圍（以 oracle.ts 比對）。
// 段落在 prompt 中會跳脫，所以以 escapeText() 後的文字比對 <passages> 區段（同 leakage.test.ts）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import type { QaContext } from "../../src/qa/answer";
import { askEach } from "../../src/qa/compare";
import { escapeText } from "../../src/qa/prompt";
import { answered, fakeTransport } from "../../src/qa/testing";
import type { AskBody } from "../../src/qa/types";
import { openRetriever } from "../../src/retrieval/retrieve";
import { expectedVisible } from "../db/oracle";
import type { Sample } from "../db/sample";

const access = clientConfig.access;
// 對照的欄：client/access.json 的身分順序
const IDENTITIES = access.roles.map((r) => r.id);

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
const visible = (id: string) => {
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
  return content.slice(content.indexOf("<passages>"), content.indexOf("</passages>"));
};

// 每一題以 askEach 對照；回傳每一欄送出的內容與引用中不屬於該欄身分的段落與文件標題
async function leaks(database: Database) {
  const found: string[] = [];
  let sent = 0;
  let cited = 0;
  // 回答引用 prompt 中的每一個段落，讓引用的檢查涵蓋所有送出的段落
  const transport = fakeTransport((body) => answered(Array.from({ length: (passagesSection(body).match(/<passage /g) ?? []).length }, (_, i) => `[${i + 1}]`).join(" ")));
  const ctx: QaContext = {
    retriever: openRetriever(database, clientConfig.client.retrieval),
    transport,
    model: clientConfig.client.model,
    displayName: clientConfig.client.displayName,
  };
  for (const language of clientConfig.client.languages) {
    for (const q of QUERIES) {
      // 每一欄送出的 body：送出前後的長度差（本機拒答的欄不送出）
      const columnBodies: AskBody[][] = [];
      let before = transport.bodies.length;
      await askEach(
        ctx,
        IDENTITIES,
        { text: q, language },
        {
          onAnswer: (index, answer) => {
            const id = IDENTITIES[index];
            const allowed = visible(id);
            columnBodies[index] = transport.bodies.slice(before);
            before = transport.bodies.length;
            for (const body of columnBodies[index]) {
              sent++;
              const section = passagesSection(body);
              for (const p of passages) if (!allowed.passages.has(p.id) && section.includes(escapeText(p.text))) found.push(`${id}：段落 ${p.id}`);
              for (const d of documents) {
                if (!allowed.documents.has(d.id) && section.includes(`title="${escapeText(d.title)}"`)) found.push(`${id}：文件 ${d.id}`);
              }
            }
            if (answer.kind === "answer") {
              for (const pid of [...answer.cited, ...answer.numbering]) {
                cited++;
                if (!allowed.passages.has(pid)) found.push(`${id}：引用 ${pid}`);
              }
            }
          },
        },
      );
    }
  }
  return { found, sent, cited };
}

describe("身分對照的權限滲漏", { timeout: 60_000 }, () => {
  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    const { found } = await leaks(ignoring);
    expect(found.some((f) => f.includes("段落"))).toBe(true);
    expect(found.some((f) => f.includes("文件"))).toBe(true);
    expect(found.some((f) => f.includes("引用"))).toBe(true);
  });

  it("每一題 × 每種介面語言：每一欄送出的段落、文件標題與引用滲漏 0", async () => {
    const { found, sent, cited } = await leaks(db);
    console.log(`身分對照權限滲漏 ${found.length}（${IDENTITIES.length} 欄 × ${QUERIES.length} 個查詢 × 2 種語言，送出 ${sent} 次、引用 ${cited} 個）`);
    expect(found).toEqual([]);
    expect(sent).toBeGreaterThan(0);
    expect(cited).toBeGreaterThan(0);
  });
});
