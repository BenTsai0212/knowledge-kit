// 圖譜的權限：readGraph() 的實體、關係與各自的出處段落，必須正好等於 oracle.ts 算出的可見範圍（滲漏 0、漏看 0）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { readGraph, type Graph } from "../../src/graph/read";
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

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

// readGraph() 的結果轉成 oracle 的鍵（與 KEY_SQL 相同的格式）
const keysOf = (graph: Graph) => ({
  entities: graph.entities.map((e) => e.id).sort(),
  relations: graph.relations.map((r) => r.id).sort(),
  entity_sources: graph.entities.flatMap((e) => e.sources.map((s) => `${e.id}|${s.id}`)).sort(),
  relation_sources: graph.relations.flatMap((r) => r.sources.map((s) => `${r.id}|${s.id}`)).sort(),
});
const expectedKeys = (id: string | null) => {
  const v = expectedVisible(access, sample, id);
  return {
    entities: [...v.entities].sort(),
    relations: [...v.relations].sort(),
    entity_sources: [...v.entity_sources].sort(),
    relation_sources: [...v.relation_sources].sort(),
  };
};

describe("readGraph 的權限", () => {
  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：實體、關係、出處正好等於可見範圍", async (_name, id) => {
    expect(keysOf(await readGraph(db, id))).toEqual(expectedKeys(id));
  });

  it("權限越大看得越多（防止以空結果通過）", async () => {
    const [g, s, m] = await Promise.all(["guest", "staff", "manager"].map(async (id) => (await readGraph(db, id)).entities.length));
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(s);
    expect(s).toBeLessThan(m);
  });

  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    for (const id of ["guest", "staff", null]) {
      expect(keysOf(await readGraph(ignoring, id)), String(id)).not.toEqual(expectedKeys(id));
    }
  });
});

describe("readGraph 的內容", () => {
  it("實體的類型、名稱與各語言的顯示名稱與資料集相同；關係的兩端與類型相同", async () => {
    const graph = await readGraph(db, "manager");
    for (const e of dataset.entities.entities) {
      expect(graph.entities.find((g) => g.id === e.id), e.id).toMatchObject({ type: e.type, name: e.name, names: e.names });
    }
    for (const r of dataset.relations.relations) {
      expect(graph.relations.find((g) => g.id === r.id), r.id).toMatchObject({ type: r.type, from: r.from, to: r.to });
    }
  });

  it("出處段落帶出文件標題、語言與內容", async () => {
    const graph = await readGraph(db, "manager");
    for (const s of graph.entities.flatMap((e) => e.sources)) {
      const p = passages.find((x) => x.id === s.id)!;
      expect(s).toEqual({ id: p.id, documentId: p.doc.id, documentTitle: p.doc.title, language: p.language ?? p.doc.language, content: p.text });
    }
  });

  it("兩位林志明是不同的實體，顯示名稱相同", async () => {
    const lins = (await readGraph(db, "staff")).entities.filter((e) => e.name === "林志明");
    expect(lins.map((e) => e.id).sort()).toEqual(["person-lin-zhiming-rd", "person-lin-zhiming-sales"]);
    expect(lins.map((e) => e.names.en)).toEqual(["Zhiming Lin", "Zhiming Lin"]);
  });
});
