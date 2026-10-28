// 待審與核准的權限（#44）：以 oracle.ts 比對每個身分看得到的待審項目與決定、能做的決定，
// 偽造的寫入都被 RLS 拒絕，核准前後的圖譜與路徑和 oracle 一致。另以「一般員工也能審核」的設定，測試核准者只能處理看得到的文件。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import type { ClientConfig } from "../../src/client/types";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { approve, readReview, reject, ReviewError, writePending, type PendingInput } from "../../src/extraction/store";
import { shortestPath } from "../../src/graph/path";
import { readGraph } from "../../src/graph/read";
import { readTimeline } from "../../src/graph/timeline";
import { ask } from "../../src/qa/answer";
import { fakeTransport } from "../../src/qa/testing";
import { openRetriever } from "../../src/retrieval/retrieve";
import { readSource } from "../../src/sources/source";
import { uploadDocument } from "../../src/upload/write";
import { datasetSample } from "../db/dataset-sample";
import { approvedSample, canDecide, expectedReviewVisible, expectedVisible, REVIEW_KEY_SQL, type ReviewSample } from "../db/oracle";
import type { Sample } from "../db/sample";

const IDENTITIES = ["guest", "staff", "manager", null, "nobody"];
const OPTIONS = { languages: clientConfig.client.languages };
const DEFAULT = { defaultLanguage: clientConfig.client.defaultLanguage };
// 一般員工也能審核的設定：用來測試「只能審核看得到的文件」
const STAFF_REVIEWS: ClientConfig = {
  ...clientConfig,
  access: { ...clientConfig.access, roles: clientConfig.access.roles.map((r) => (r.id === "staff" ? { ...r, canReview: true } : r)) },
};

interface World {
  db: Database;
  config: ClientConfig;
  sample: Sample;
  review: ReviewSample;
  dm: { documentId: string; passageIds: string[] };
  ds: { documentId: string; passageIds: string[] };
}

// 主管上傳一份機密文件、一般員工上傳一份青翼專案的內部文件，各寫入萃取結果（內容虛構）
async function setup(config: ClientConfig = clientConfig): Promise<World> {
  const db = await openDatabase(config, { seed: (pg) => seedDataset(pg, config, dataset) });
  const dm = await uploadDocument(
    db,
    "manager",
    { title: "第二廠評估（虛構）", language: "zh-TW", visibility: "confidential", project: null, date: "2026-10-01", passages: ["測試人員甲加入營運部，負責第二廠評估。", "第二廠的預算尚未核定。"] },
    OPTIONS,
  );
  const ds = await uploadDocument(
    db,
    "staff",
    { title: "青翼試用紀錄（虛構）", language: "zh-TW", visibility: "internal", project: "bluewing", date: "2026-10-02", passages: ["林志明參與青翼專案的使用者測試。"] },
    OPTIONS,
  );
  const fromDm: PendingInput = {
    entities: [
      { id: "pe-m1", type: "person", names: { "zh-TW": "測試人員甲", en: "Test Person A" }, sources: [dm.passageIds[0]] },
      { id: "pe-m2", type: "team", names: { "zh-TW": "營運部", en: "Operations" }, sources: [dm.passageIds[0]] },
    ],
    relations: [{ id: "pr-m1", type: "member-of", from: "pe-m1", to: "pe-m2", sources: [dm.passageIds[0]] }],
  };
  const fromDs: PendingInput = {
    entities: [
      { id: "pe-s1", type: "person", names: { "zh-TW": "林志明", en: "Zhiming Lin" }, sources: [ds.passageIds[0]] },
      { id: "pe-s2", type: "project", names: { "zh-TW": "青翼專案", en: "Project Bluewing" }, sources: [ds.passageIds[0]] },
    ],
    relations: [{ id: "pr-s1", type: "works-on", from: "pe-s1", to: "pe-s2", sources: [ds.passageIds[0]] }],
  };
  await writePending(db, "manager", dm.documentId, fromDm);
  await writePending(db, "staff", ds.documentId, fromDs);

  const sample: Sample = {
    ...datasetSample,
    docs: [
      ...datasetSample.docs,
      { id: dm.documentId, level: "confidential", project: null },
      { id: ds.documentId, level: "internal", project: "bluewing" },
    ],
    passages: [
      ...datasetSample.passages,
      ...dm.passageIds.map((id) => ({ id, doc: dm.documentId, level: "confidential", project: null })),
      ...ds.passageIds.map((id) => ({ id, doc: ds.documentId, level: "internal", project: "bluewing" })),
    ],
  };
  const review: ReviewSample = {
    pendingEntities: [
      ...fromDm.entities.map((e) => ({ id: e.id, doc: dm.documentId, type: e.type, sources: e.sources })),
      ...fromDs.entities.map((e) => ({ id: e.id, doc: ds.documentId, type: e.type, sources: e.sources })),
    ],
    pendingRelations: [
      ...fromDm.relations.map((r) => ({ id: r.id, doc: dm.documentId, from: r.from, to: r.to, sources: r.sources })),
      ...fromDs.relations.map((r) => ({ id: r.id, doc: ds.documentId, from: r.from, to: r.to, sources: r.sources })),
    ],
    decisions: [],
  };
  return { db, config, sample, review, dm, ds };
}

const queryReview = (db: Database, id: string | null) =>
  db.withIdentity(id, async (tx) => {
    const out: Record<string, string[]> = {};
    for (const [table, key] of Object.entries(REVIEW_KEY_SQL)) {
      out[table] = (await tx.query<{ k: string }>(`SELECT ${key} AS k FROM kk.${table}`)).rows.map((r) => r.k).sort();
    }
    return out;
  });
const sorted = (v: Record<string, string[]>) => Object.fromEntries(Object.entries(v).map(([k, list]) => [k, [...list].sort()]));

const graphKeys = async (db: Database, id: string | null) => {
  const g = await readGraph(db, id);
  return {
    entities: g.entities.map((e) => e.id).sort(),
    relations: g.relations.map((r) => r.id).sort(),
    entity_sources: g.entities.flatMap((e) => e.sources.map((s) => `${e.id}|${s.id}`)).sort(),
    relation_sources: g.relations.flatMap((r) => r.sources.map((s) => `${r.id}|${s.id}`)).sort(),
  };
};
const expectedGraph = (w: World, id: string | null) => {
  const v = expectedVisible(w.config.access, approvedSample(w.sample, w.review), id);
  return {
    entities: [...v.entities].sort(),
    relations: [...v.relations].sort(),
    entity_sources: [...v.entity_sources].sort(),
    relation_sources: [...v.relation_sources].sort(),
  };
};

describe("寫入待審（上傳者）", () => {
  it("只能寫入自己上傳的文件；寫入後，沒有 canReview 的上傳者讀不到", async () => {
    const w = await setup();
    const one = (doc: string, passage: string): PendingInput => ({
      entities: [{ id: `pe-x-${doc.slice(-6)}`, type: "team", names: { "zh-TW": "x", en: "x" }, sources: [passage] }],
      relations: [],
    });
    await expect(writePending(w.db, "staff", w.dm.documentId, one(w.dm.documentId, w.dm.passageIds[0]))).rejects.toMatchObject({ reason: "denied" });
    await expect(writePending(w.db, "staff", "bluewing-kickoff-zh", one("bluewing-kickoff-zh", "bluewing-kickoff-zh-01"))).rejects.toMatchObject({ reason: "denied" });
    await expect(writePending(w.db, null, w.ds.documentId, one(w.ds.documentId, w.ds.passageIds[0]))).rejects.toMatchObject({ reason: "denied" });
    // 出處不屬於這份文件 → 外鍵拒絕
    await expect(writePending(w.db, "staff", w.ds.documentId, one(w.ds.documentId, w.dm.passageIds[0]))).rejects.toMatchObject({ reason: "denied" });
    expect(Object.values(await queryReview(w.db, "staff")).flat()).toEqual([]);
    await w.db.close();
  });

  it("待審 id 的格式：實體以 pe- 開頭、關係以 pr- 開頭，違反時被拒絕（#45 審查）", async () => {
    const w = await setup();
    const p = w.ds.passageIds[0];
    const entity = (id: string) => ({ id, type: "team", names: { "zh-TW": "x", en: "x" }, sources: [p] });
    for (const bad of ["x-1", "pr-1", "team-rd"]) {
      await expect(writePending(w.db, "staff", w.ds.documentId, { entities: [entity(bad)], relations: [] }), bad).rejects.toMatchObject({ reason: "denied" });
    }
    for (const bad of ["pe-r1", "x-r1"]) {
      await expect(
        writePending(w.db, "staff", w.ds.documentId, {
          entities: [entity("pe-a1"), entity("pe-b1")],
          relations: [{ id: bad, type: "member-of", from: "pe-a1", to: "pe-b1", sources: [p] }],
        }),
        bad,
      ).rejects.toMatchObject({ reason: "denied" });
    }
    await w.db.close();
  });
});

describe.each([
  ["參考設定（只有主管審核）", clientConfig],
  ["一般員工也能審核", STAFF_REVIEWS],
])("待審項目的可見範圍：%s", (_name, config) => {
  it("每個身分看得到的待審項目與決定，正好等於 oracle", async () => {
    const w = await setup(config);
    await reject(w.db, "manager", { entities: ["pe-m2"], relations: [] });
    w.review.decisions.push({ item: "pe-m2", decision: "reject" }, { item: "pr-m1", decision: "reject" });
    for (const id of IDENTITIES) {
      expect(await queryReview(w.db, id), String(id)).toEqual(sorted(expectedReviewVisible(config.access, w.sample, w.review, id)));
    }
    // 防止以全部看不到而通過
    expect(expectedReviewVisible(config.access, w.sample, w.review, "manager").pending_entities).toHaveLength(4);
    await w.db.close();
  });

  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const w = await setup(config);
    const ignoring: Database = { withIdentity: (_id, fn) => w.db.withIdentity("manager", fn), close: w.db.close };
    for (const id of ["guest", "staff", null]) {
      expect(await queryReview(ignoring, id), String(id)).not.toEqual(sorted(expectedReviewVisible(config.access, w.sample, w.review, id)));
    }
    await w.db.close();
  });
});

describe("能做的決定", () => {
  it("沒有 canReview 的身分不能核准、退回、修改名稱", async () => {
    const w = await setup();
    for (const id of ["guest", "staff", null, "nobody"]) {
      expect(canDecide(w.config.access, w.sample, w.review, id, "pe-s1", { decision: "approve" })).toBe(false);
      await expect(approve(w.db, id, { entities: [{ id: "pe-s2" }], relations: [] }, DEFAULT), String(id)).rejects.toMatchObject({ reason: "denied" });
      await expect(approve(w.db, id, { entities: [{ id: "pe-s2", names: { "zh-TW": "改", en: "x" } }], relations: [] }, DEFAULT)).rejects.toBeInstanceOf(ReviewError);
      await expect(reject(w.db, id, { entities: ["pe-s2"], relations: [] }), String(id)).rejects.toMatchObject({ reason: "denied" });
    }
    await w.db.close();
  });

  it("核准者不能處理看不到的文件，也不能合併到看不到或類型不同的實體（一般員工也能審核的設定）", async () => {
    const w = await setup(STAFF_REVIEWS);
    const access = STAFF_REVIEWS.access;
    expect(canDecide(access, w.sample, w.review, "staff", "pe-m1", { decision: "approve" })).toBe(false);
    await expect(approve(w.db, "staff", { entities: [{ id: "pe-m1" }], relations: [] }, DEFAULT)).rejects.toMatchObject({ reason: "denied" });
    await expect(reject(w.db, "staff", { entities: ["pe-m1"], relations: [] })).rejects.toMatchObject({ reason: "denied" });
    // 長堤專案對一般員工看不到
    expect(canDecide(access, w.sample, w.review, "staff", "pe-s2", { decision: "approve", mergeInto: "project-longpier" })).toBe(false);
    await expect(approve(w.db, "staff", { entities: [{ id: "pe-s2", mergeInto: "project-longpier" }], relations: [] }, DEFAULT)).rejects.toMatchObject({
      reason: "denied",
    });
    // 類型不同（人員合併到部門）
    await expect(approve(w.db, "staff", { entities: [{ id: "pe-s1", mergeInto: "team-rd" }], relations: [] }, DEFAULT)).rejects.toMatchObject({ reason: "denied" });
    // 看得到的就可以
    expect(canDecide(access, w.sample, w.review, "staff", "pe-s1", { decision: "approve", mergeInto: "person-lin-zhiming-rd" })).toBe(true);
    await approve(w.db, "staff", { entities: [{ id: "pe-s1", mergeInto: "person-lin-zhiming-rd" }], relations: [] }, DEFAULT);
    await w.db.close();
  });

  it("每個項目只能有一筆決定；退回不能帶名稱或合併對象；關係要兩端都已核准", async () => {
    const w = await setup();
    await expect(approve(w.db, "manager", { entities: [], relations: ["pr-s1"] }, DEFAULT)).rejects.toMatchObject({ reason: "denied" });
    await approve(w.db, "manager", { entities: [{ id: "pe-s2", mergeInto: "project-bluewing" }], relations: [] }, DEFAULT);
    await expect(approve(w.db, "manager", { entities: [{ id: "pe-s2" }], relations: [] }, DEFAULT)).rejects.toMatchObject({ reason: "conflict" });
    await expect(reject(w.db, "manager", { entities: ["pe-s2"], relations: [] })).rejects.toMatchObject({ reason: "conflict" });
    const insert = (sql: string) => w.db.withIdentity("manager", (tx) => tx.exec(sql));
    await expect(insert("INSERT INTO kk.review_decisions (item_id, decision, decided_by, names) VALUES ('pe-s1', 'reject', 'manager', '{\"en\":\"x\"}')")).rejects.toThrow(/check constraint/);
    // 合併對象是看得到、類型相同的實體，只違反「退回不帶合併對象」的 CHECK
    await expect(insert("INSERT INTO kk.review_decisions (item_id, decision, decided_by, merge_into) VALUES ('pe-s1', 'reject', 'manager', 'person-lin-zhiming-rd')")).rejects.toThrow(/check constraint/);
    // 決定者寫成別人
    await expect(insert("INSERT INTO kk.review_decisions (item_id, decision, decided_by) VALUES ('pe-s1', 'reject', 'guest')")).rejects.toThrow(/row-level security/);
    await w.db.close();
  });
});

describe("偽造的正式資料寫入", () => {
  const forged = async (sql: string, setupDecision?: string) => {
    const w = await setup();
    if (setupDecision) await w.db.withIdentity("manager", (tx) => tx.exec(setupDecision));
    const result = w.db.withIdentity("manager", (tx) => tx.exec(sql));
    await expect(result, sql).rejects.toThrow(/row-level security/);
    await w.db.close();
  };
  const APPROVE_M1 = "INSERT INTO kk.review_decisions (item_id, decision, decided_by) VALUES ('pe-m1', 'approve', 'manager')";

  it.each([
    ["沒有決定就寫入實體", `INSERT INTO kk.entities (id, entity_type, name, names) VALUES ('pe-m1', 'person', '測試人員甲', '{"zh-TW":"測試人員甲","en":"Test Person A"}')`, undefined],
    ["名稱與核准時不同", `INSERT INTO kk.entities (id, entity_type, name, names) VALUES ('pe-m1', 'person', '別人', '{"zh-TW":"別人","en":"Someone"}')`, APPROVE_M1],
    ["類型與待審不同", `INSERT INTO kk.entities (id, entity_type, name, names) VALUES ('pe-m1', 'team', '測試人員甲', '{"zh-TW":"測試人員甲","en":"Test Person A"}')`, APPROVE_M1],
    ["name 不是 names 的值", `INSERT INTO kk.entities (id, entity_type, name, names) VALUES ('pe-m1', 'person', '別人', '{"zh-TW":"測試人員甲","en":"Test Person A"}')`, APPROVE_M1],
    ["出處不是待審實體的出處", `INSERT INTO kk.entity_sources (entity_id, passage_id) VALUES ('pe-m1', 'org-chart-zh-01')`, APPROVE_M1],
    ["出處加到別的實體", `INSERT INTO kk.entity_sources (entity_id, passage_id) SELECT 'team-ops', passage_id FROM kk.pending_entity_sources WHERE pending_entity_id = 'pe-m1'`, APPROVE_M1],
  ])("%s → 拒絕", async (_name, sql, decision) => {
    await forged(sql, decision);
  });

  it("關係的類型或兩端與核准的待審關係不同 → 拒絕", async () => {
    const w = await setup();
    await approve(w.db, "manager", { entities: [{ id: "pe-m1" }, { id: "pe-m2", mergeInto: "team-ops" }], relations: [] }, DEFAULT);
    await w.db.withIdentity("manager", (tx) => tx.exec("INSERT INTO kk.review_decisions (item_id, decision, decided_by) VALUES ('pr-m1', 'approve', 'manager')"));
    for (const sql of [
      "INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id) VALUES ('pr-m1', 'leads', 'pe-m1', 'team-ops')",
      "INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id) VALUES ('pr-m1', 'member-of', 'pe-m1', 'team-rd')",
      "INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id) VALUES ('pr-m1', 'member-of', 'person-wang-xiaoming', 'team-ops')",
    ]) {
      await expect(w.db.withIdentity("manager", (tx) => tx.exec(sql)), sql).rejects.toThrow(/row-level security/);
    }
    await w.db.close();
  });
});

describe("核准與退回", () => {
  it("核准：修改名稱建立新實體、合併到既有實體、關係的兩端解析成核准後的實體；狀態寫入待審區", async () => {
    const w = await setup();
    const names = { "zh-TW": "測試人員乙", en: "Test Person B" };
    await approve(w.db, "manager", { entities: [{ id: "pe-m1", names }, { id: "pe-m2", mergeInto: "team-ops" }], relations: ["pr-m1"] }, DEFAULT);
    const graph = await readGraph(w.db, "manager");
    expect(graph.entities.find((e) => e.id === "pe-m1")).toMatchObject({ type: "person", name: "測試人員乙", names });
    expect(graph.entities.find((e) => e.id === "team-ops")!.sources.map((s) => s.id)).toContain(w.dm.passageIds[0]);
    expect(graph.relations.find((r) => r.id === "pr-m1")).toMatchObject({ type: "member-of", from: "pe-m1", to: "team-ops" });
    const doc = (await readReview(w.db, "manager")).find((d) => d.id === w.dm.documentId)!;
    expect(doc.entities.map((e) => [e.id, e.status, e.mergedInto])).toEqual([
      ["pe-m1", "approved", null],
      ["pe-m2", "approved", "team-ops"],
    ]);
    expect(doc.relations.map((r) => [r.id, r.status])).toEqual([["pr-m1", "approved"]]);
    await w.db.close();
  });

  it("退回實體時，依附它的待審關係一併退回；任何一列被拒絕時整筆不寫入", async () => {
    const w = await setup();
    await reject(w.db, "manager", { entities: ["pe-s1"], relations: ["pr-s1"] });
    const doc = (await readReview(w.db, "manager")).find((d) => d.id === w.ds.documentId)!;
    expect(doc.entities.map((e) => [e.id, e.status])).toEqual([
      ["pe-s1", "rejected"],
      ["pe-s2", "pending"],
    ]);
    expect(doc.relations).toMatchObject([{ id: "pr-s1", status: "rejected", rejectedWithEntity: true }]);
    // pe-s2 可以核准，但合併到看不到的實體不存在時整筆失敗，pe-s2 仍是待審
    await expect(approve(w.db, "manager", { entities: [{ id: "pe-s2" }, { id: "pe-m1", mergeInto: "nope" }], relations: [] }, DEFAULT)).rejects.toMatchObject({
      reason: "denied",
    });
    expect((await readReview(w.db, "manager")).find((d) => d.id === w.ds.documentId)!.entities[1].status).toBe("pending");
    await w.db.close();
  });
});

describe("核准前後的可見範圍", () => {
  it("每個身分的圖譜與 oracle 一致；主管上傳的機密文件核准後，一般員工看不到新實體與關係", async () => {
    const w = await setup();
    for (const id of IDENTITIES) expect(await graphKeys(w.db, id), `核准前 ${id}`).toEqual(expectedGraph(w, id));

    await approve(w.db, "manager", { entities: [{ id: "pe-m1" }, { id: "pe-m2", mergeInto: "team-ops" }], relations: ["pr-m1"] }, DEFAULT);
    await approve(w.db, "manager", { entities: [{ id: "pe-s1", mergeInto: "person-lin-zhiming-rd" }, { id: "pe-s2", mergeInto: "project-bluewing" }], relations: ["pr-s1"] }, DEFAULT);
    w.review.decisions.push(
      { item: "pe-m1", decision: "approve" },
      { item: "pe-m2", decision: "approve", mergeInto: "team-ops" },
      { item: "pr-m1", decision: "approve" },
      { item: "pe-s1", decision: "approve", mergeInto: "person-lin-zhiming-rd" },
      { item: "pe-s2", decision: "approve", mergeInto: "project-bluewing" },
      { item: "pr-s1", decision: "approve" },
    );
    for (const id of IDENTITIES) expect(await graphKeys(w.db, id), `核准後 ${id}`).toEqual(expectedGraph(w, id));

    const staff = await readGraph(w.db, "staff");
    expect(staff.entities.map((e) => e.id)).not.toContain("pe-m1");
    expect(staff.relations.map((r) => r.id)).not.toContain("pr-m1");
    expect(staff.relations.map((r) => r.id)).toContain("pr-s1");
    expect(shortestPath(await readGraph(w.db, "manager"), "pe-m1", "team-ops")).toHaveLength(2);
    expect(shortestPath(staff, "pe-m1", "team-ops")).toBeNull();
    await w.db.close();
  });

  it("檢索、問答送出的內容、時間軸、原文：核准前後都和 oracle 一致，不含待審或已退回的名稱", async () => {
    const w = await setup();
    const check = async (label: string) => {
      const sample = approvedSample(w.sample, w.review);
      for (const id of IDENTITIES) {
        const visible = expectedVisible(w.config.access, sample, id);
        const passages = new Set(visible.passages);
        const entities = new Set(visible.entities);
        const retriever = openRetriever(w.db, w.config.client.retrieval);
        const transport = fakeTransport();
        const ctx = { retriever, transport, model: w.config.client.model, displayName: w.config.client.displayName };
        for (const p of [...w.dm.passageIds, ...w.ds.passageIds]) {
          const results = await retriever.retrieve(id, "測試人員甲 營運部 林志明 青翼專案");
          expect(results.filter((r) => !passages.has(r.id)).map((r) => r.id), `${label} ${id} 檢索`).toEqual([]);
          expect((await readSource(w.db, id, p)) === null, `${label} ${id} 原文 ${p}`).toBe(!passages.has(p));
        }
        await ask(ctx, { identityId: id, text: "測試人員甲在哪個部門？", language: "zh-TW" });
        // 問答只送出段落；待審實體的英文名稱不在任何段落中，不可出現
        expect(transport.bodies.some((b) => b.messages[0].content.includes("Test Person A")), `${label} ${id} 問答`).toBe(false);
        const timeline = await readTimeline(w.db, id, { language: "zh-TW" });
        expect(timeline.flatMap((e) => e.passages.flatMap((p) => p.entityIds)).filter((e) => !entities.has(e)), `${label} ${id} 時間軸`).toEqual([]);
        expect(timeline.flatMap((e) => e.passages.map((p) => p.id)).filter((p) => !passages.has(p)), `${label} ${id} 時間軸段落`).toEqual([]);
      }
    };
    await reject(w.db, "manager", { entities: ["pe-s1"], relations: [] });
    w.review.decisions.push({ item: "pe-s1", decision: "reject" }, { item: "pr-s1", decision: "reject" });
    await check("核准前");
    await approve(w.db, "manager", { entities: [{ id: "pe-m1" }, { id: "pe-m2", mergeInto: "team-ops" }], relations: ["pr-m1"] }, DEFAULT);
    w.review.decisions.push({ item: "pe-m1", decision: "approve" }, { item: "pe-m2", decision: "approve", mergeInto: "team-ops" }, { item: "pr-m1", decision: "approve" });
    await check("核准後");
    // 核准後，主管的時間軸中這份文件的段落帶出新實體；一般員工看不到這份文件
    const manager = await readTimeline(w.db, "manager", { language: "zh-TW" });
    expect(manager.find((e) => e.documentId === w.dm.documentId)!.passages[0].entityIds).toEqual(expect.arrayContaining(["pe-m1", "team-ops"]));
    await w.db.close();
  });
});
