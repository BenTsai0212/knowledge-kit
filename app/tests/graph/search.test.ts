// 圖譜的找起點（#199）：搜尋與「關聯最多」只會有目前身分看得到的實體（滲漏 0），看得到的實體都搜得到（漏看 0）；
// 關聯數只算看得到的關係。以 oracle.ts 算出的可見範圍比對每個身分（3 個角色、null、不存在的身分）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { readGraph } from "../../src/graph/read";
import { relationCounts, SEARCH_LIMIT, searchEntities, topConnected } from "../../src/graph/search";
import { expectedVisible } from "../db/oracle";
import type { Sample } from "../db/sample";

const { access, client, knowledgeModel } = clientConfig;
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
// oracle 的可見範圍（實體與關係的 id）
const visibleOf = (id: string | null) => {
  const v = expectedVisible(access, sample, id);
  return { entities: new Set(v.entities), relations: new Set(v.relations) };
};
const allNames = (e: (typeof dataset.entities.entities)[number]) => [e.name, ...Object.values(e.names)];

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

describe("搜尋與關聯最多的權限", () => {
  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：搜尋每個實體的所有名稱，結果只含看得到的實體，看得到的都搜得到", async (_name, id) => {
    const graph = await readGraph(db, id);
    const visible = visibleOf(id);
    for (const language of client.languages) {
      for (const e of dataset.entities.entities) {
        for (const name of allNames(e)) {
          const found = searchEntities(graph, name, language, knowledgeModel.entityTypes).map((x) => x.id);
          for (const f of found) expect(visible.entities.has(f), `${String(id)} 搜尋「${name}」得到 ${f}`).toBe(true);
          // 同名或名稱包含查詢的實體很多時可能超過上限，只在結果未滿時要求找得到
          if (visible.entities.has(e.id) && found.length < SEARCH_LIMIT) expect(found, `${String(id)} 搜尋「${name}」`).toContain(e.id);
        }
      }
    }
  });

  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：關聯最多只含看得到的實體，關聯數只算看得到的關係", async (_name, id) => {
    const graph = await readGraph(db, id);
    const visible = visibleOf(id);
    const expectedCount = (entityId: string) =>
      dataset.relations.relations.filter((r) => visible.relations.has(r.id) && (r.from === entityId || r.to === entityId)).length;
    for (const { entity, count } of topConnected(graph, client.defaultLanguage)) {
      expect(visible.entities.has(entity.id), entity.id).toBe(true);
      expect(count, entity.id).toBe(expectedCount(entity.id));
    }
    for (const [entityId, count] of relationCounts(graph)) expect(count, entityId).toBe(expectedCount(entityId));
  });

  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層，一般身分會搜到看不到的實體", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    const hidden = dataset.entities.entities.filter((e) => !visibleOf("guest").entities.has(e.id));
    expect(hidden.length).toBeGreaterThan(0);
    const graph = await readGraph(ignoring, "guest");
    const leaked = hidden.filter((e) => searchEntities(graph, e.name, client.defaultLanguage, knowledgeModel.entityTypes).some((x) => x.id === e.id));
    expect(leaked.length).toBeGreaterThan(0);
  });
});
