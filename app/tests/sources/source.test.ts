// 原文的權限：每個身分 × 每段段落，以 oracle.ts 比對 readSource() 的結果。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { readSource } from "../../src/sources/source";
import { expectedVisible } from "../db/oracle";
import type { Sample } from "../db/sample";

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

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

describe("readSource", () => {
  it("每個身分 × 每段段落：看不到時回 null；看得到時只回該文件中看得到的段落，依順序", async () => {
    let opened = 0;
    for (const id of IDENTITIES) {
      const visible = new Set(expectedVisible(access, sample, id).passages);
      for (const doc of documents) {
        for (const p of doc.passages) {
          const source = await readSource(db, id, p.id);
          if (!visible.has(p.id)) {
            expect(source, `${id}：${p.id}`).toBeNull();
            continue;
          }
          opened++;
          expect(source, `${id}：${p.id}`).toEqual({
            id: doc.id,
            title: doc.title,
            language: doc.language,
            visibility: doc.visibility,
            project: doc.project ?? null,
            passages: doc.passages.filter((q) => visible.has(q.id)).map((q) => ({ id: q.id, content: q.text })),
            highlight: p.id,
          });
        }
      }
    }
    // 防止以全部回 null 而通過
    expect(opened).toBeGreaterThan(0);
  });

  it("文件中比文件更機密的段落，對看得到文件的一般員工省略", async () => {
    const source = await readSource(db, "staff", "bluewing-kickoff-zh-01");
    expect(source?.passages.map((p) => p.id)).toEqual(["bluewing-kickoff-zh-01", "bluewing-kickoff-zh-02"]);
    expect((await readSource(db, "manager", "bluewing-kickoff-zh-01"))?.passages).toHaveLength(3);
  });

  it("不存在的段落回 null", async () => {
    expect(await readSource(db, "manager", "nope")).toBeNull();
  });
});
