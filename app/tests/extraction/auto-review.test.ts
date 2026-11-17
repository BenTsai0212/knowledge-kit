// 直接收錄（ADR 0011 決定 4，migration 0013）：上傳者寫入 mode = 'auto' 的決定與正式資料的權限。
// 以 oracle.ts 的 canAutoDecide() 比對每個身分 × 每個項目能否寫入；接縫（unsure、名稱有空白）、別人的文件、
// 看不到的合併對象、兩端未核准的關係都被拒絕；沒有 canReview 的上傳者不能寫 manual 決定，也不能依別人的決定寫入正式資料。
// 接縫的其餘條件（合併候選數、編輯距離、名稱涵蓋所有語言）由 store.ts 判斷，在 PR 2b 測試
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { approve, retract, writePending, type PendingInput } from "../../src/extraction/store";
import { readGraph } from "../../src/graph/read";
import { uploadDocument } from "../../src/upload/write";
import { datasetSample } from "../db/dataset-sample";
import { approvedSample, canAutoDecide, expectedReviewVisible, expectedVisible, REVIEW_KEY_SQL, type ReviewSample } from "../db/oracle";
import type { Sample } from "../db/sample";

const access = clientConfig.access;
const IDENTITIES = ["guest", "staff", "manager", null, "nobody"];
const OPTIONS = { languages: clientConfig.client.languages };

interface World {
  db: Database;
  sample: Sample;
  review: ReviewSample;
  dm: string;
  ds: string;
}

// 主管上傳一份機密文件、一般員工上傳一份青翼專案的內部文件（內容虛構）。一般員工的文件另有兩個接縫：
// 模型標示沒把握的 pe-s3 與 pr-s3、英文名稱空白的 pe-s4（這裡由上傳者以 SQL 直接寫入待審，不經萃取）
async function setup(): Promise<World> {
  const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  const dm = await uploadDocument(
    db,
    "manager",
    { title: "第二廠評估（虛構）", language: "zh-TW", visibility: "confidential", project: null, date: "2026-10-01", passages: ["測試人員甲加入營運部。"] },
    OPTIONS,
  );
  const ds = await uploadDocument(
    db,
    "staff",
    { title: "青翼試用紀錄（虛構）", language: "zh-TW", visibility: "internal", project: "bluewing", date: "2026-10-02", passages: ["林志明帶領青翼專案的使用者測試。"] },
    OPTIONS,
  );
  const p = ds.passageIds[0];
  const fromDm: PendingInput = {
    entities: [{ id: "pe-m1", type: "person", names: { "zh-TW": "測試人員甲", en: "Test Person A" }, sources: [dm.passageIds[0]] }],
    relations: [],
  };
  const fromDs: PendingInput = {
    entities: [
      { id: "pe-s1", type: "person", names: { "zh-TW": "林志明", en: "Zhiming Lin" }, sources: [p] },
      { id: "pe-s2", type: "project", names: { "zh-TW": "青翼專案", en: "Project Bluewing" }, sources: [p] },
    ],
    // pr-s2 是反方向：只有一端核准時，兩個方向都要被拒絕
    relations: [
      { id: "pr-s1", type: "leads", from: "pe-s1", to: "pe-s2", sources: [p] },
      { id: "pr-s2", type: "works-on", from: "pe-s2", to: "pe-s1", sources: [p] },
    ],
  };
  await writePending(db, "manager", dm.documentId, fromDm);
  await writePending(db, "staff", ds.documentId, fromDs);
  await db.withIdentity("staff", async (tx) => {
    await tx.query(
      `INSERT INTO kk.pending_entities (id, document_id, entity_type, names, unsure) VALUES
         ('pe-s3', $1, 'person', '{"zh-TW":"林志明","en":"Zhiming Lin"}', 'same_name'),
         ('pe-s4', $1, 'team', '{"zh-TW":"測試小組","en":" "}', NULL)`,
      [ds.documentId],
    );
    await tx.query(
      `INSERT INTO kk.pending_entity_sources (pending_entity_id, document_id, passage_id) VALUES ('pe-s3', $1, $2), ('pe-s4', $1, $2)`,
      [ds.documentId, p],
    );
    await tx.query(
      `INSERT INTO kk.pending_relations (id, document_id, relation_type, from_pending_id, to_pending_id, unsure) VALUES ('pr-s3', $1, 'member-of', 'pe-s1', 'pe-s2', 'relation_wording')`,
      [ds.documentId],
    );
    await tx.query(`INSERT INTO kk.pending_relation_sources (pending_relation_id, document_id, passage_id) VALUES ('pr-s3', $1, $2)`, [ds.documentId, p]);
  });

  const sample: Sample = {
    ...datasetSample,
    docs: [...datasetSample.docs, { id: dm.documentId, level: "confidential", project: null }, { id: ds.documentId, level: "internal", project: "bluewing" }],
    passages: [
      ...datasetSample.passages,
      { id: dm.passageIds[0], doc: dm.documentId, level: "confidential", project: null },
      { id: p, doc: ds.documentId, level: "internal", project: "bluewing" },
    ],
  };
  const review: ReviewSample = {
    uploads: { [dm.documentId]: "manager", [ds.documentId]: "staff" },
    pendingEntities: [
      { id: "pe-m1", doc: dm.documentId, type: "person", sources: [dm.passageIds[0]] },
      ...["pe-s1", "pe-s2", "pe-s3", "pe-s4"].map((id) => ({ id, doc: ds.documentId, type: "", sources: [p] })),
    ],
    pendingRelations: [
      { id: "pr-s1", doc: ds.documentId, from: "pe-s1", to: "pe-s2", sources: [p] },
      { id: "pr-s2", doc: ds.documentId, from: "pe-s2", to: "pe-s1", sources: [p] },
      { id: "pr-s3", doc: ds.documentId, from: "pe-s1", to: "pe-s2", sources: [p] },
    ],
    decisions: [],
    retractions: [],
  };
  return { db, sample, review, dm: dm.documentId, ds: ds.documentId };
}

// round 依 0009 的 kk.next_round()；已有有效的決定時是 NULL，寫入失敗
const autoSql = "INSERT INTO kk.review_decisions (item_id, round, decision, decided_by, mode, merge_into) VALUES ($1, kk.next_round($1), 'approve', $2, 'auto', $3)";

// 直接收錄一個新實體：決定、實體與出處（比照 store.ts 的 approve()）
async function autoEntity(db: Database, id: string | null, item: string, mergeInto?: string) {
  return db.withIdentity(id, async (tx) => {
    await tx.query(autoSql, [item, id, mergeInto ?? null]);
    if (mergeInto !== undefined) {
      await tx.query(
        "INSERT INTO kk.entity_sources (entity_id, passage_id, decision_id) SELECT $2, passage_id, $1 FROM kk.pending_entity_sources WHERE pending_entity_id = $1",
        [item, mergeInto],
      );
      return;
    }
    await tx.query("INSERT INTO kk.entities (id, entity_type, name, names) SELECT id, entity_type, names->>'zh-TW', names FROM kk.pending_entities WHERE id = $1", [item]);
    await tx.query("INSERT INTO kk.entity_sources (entity_id, passage_id, decision_id) SELECT $1, passage_id, $1 FROM kk.pending_entity_sources WHERE pending_entity_id = $1", [item]);
  });
}

async function autoRelation(db: Database, id: string | null, item: string) {
  const endpoints = `JOIN kk.review_decisions f ON f.item_id = r.from_pending_id AND f.decision = 'approve'
                     JOIN kk.review_decisions t ON t.item_id = r.to_pending_id AND t.decision = 'approve'`;
  return db.withIdentity(id, async (tx) => {
    await tx.query(autoSql, [item, id, null]);
    await tx.query(
      `INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id)
       SELECT r.id, r.relation_type, coalesce(f.merge_into, f.id), coalesce(t.merge_into, t.id) FROM kk.pending_relations r ${endpoints} WHERE r.id = $1`,
      [item],
    );
    await tx.query(
      `INSERT INTO kk.relation_sources (relation_id, passage_id, from_entity_id, to_entity_id, decision_id)
       SELECT r.id, s.passage_id, coalesce(f.merge_into, f.id), coalesce(t.merge_into, t.id), r.id
         FROM kk.pending_relation_sources s JOIN kk.pending_relations r ON r.id = s.pending_relation_id ${endpoints} WHERE r.id = $1`,
      [item],
    );
  });
}

// 只試寫決定，成功後丟出例外讓交易回復，不改變資料
const ROLLBACK = new Error("rollback");
async function tryAuto(db: Database, id: string | null, item: string, mergeInto?: string): Promise<boolean> {
  try {
    await db.withIdentity(id, async (tx) => {
      await tx.query(autoSql, [item, id, mergeInto ?? null]);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e === ROLLBACK) return true;
    if (/row-level security|violates/.test(String(e))) return false;
    throw e;
  }
  return true;
}

const graphKeys = async (db: Database, id: string | null) => {
  const g = await readGraph(db, id);
  return { entities: g.entities.map((e) => e.id).sort(), relations: g.relations.map((r) => r.id).sort() };
};
const expectedGraph = (w: World, id: string | null) => {
  const v = expectedVisible(access, approvedSample(w.sample, w.review), id);
  return { entities: [...v.entities].sort(), relations: [...v.relations].sort() };
};
const queryReview = (db: Database, id: string | null) =>
  db.withIdentity(id, async (tx) => {
    const out: Record<string, string[]> = {};
    for (const [table, key] of Object.entries(REVIEW_KEY_SQL)) {
      out[table] = (await tx.query<{ k: string }>(`SELECT ${key} AS k FROM kk.${table}`)).rows.map((r) => r.k).sort();
    }
    return out;
  });
const sorted = (v: Record<string, string[]>) => Object.fromEntries(Object.entries(v).map(([k, list]) => [k, [...list].sort()]));

const SEAMS: Record<string, { unsure?: boolean; blankName?: boolean }> = { "pe-s3": { unsure: true }, "pe-s4": { blankName: true }, "pr-s3": { unsure: true } };
const CANDIDATES: { id: string; mergeInto?: string }[] = [
  { id: "pe-m1" },
  { id: "pe-s1" },
  { id: "pe-s1", mergeInto: "person-lin-zhiming-rd" },
  { id: "pe-s2", mergeInto: "project-longpier" },
  { id: "pe-s3" },
  { id: "pe-s4" },
  { id: "pr-s1" },
  { id: "pr-s2" },
  { id: "pr-s3" },
];

describe("直接收錄的決定（ADR 0011 決定 4）", { timeout: 60_000 }, () => {
  it("每個身分 × 每個項目能否寫入 auto 決定，正好等於 oracle（含兩端核准後的關係）", async () => {
    const w = await setup();
    const check = async () => {
      for (const id of IDENTITIES) {
        for (const c of CANDIDATES) {
          const expected = canAutoDecide(access, w.sample, w.review, id, { ...c, ...SEAMS[c.id] });
          expect(await tryAuto(w.db, id, c.id, c.mergeInto), `${id} ${c.id} → ${c.mergeInto}`).toBe(expected);
        }
      }
    };
    await check();
    // 防止以全部拒絕而通過：一般員工能收錄自己文件的非接縫實體，主管能收錄自己的文件；關係在兩端核准前不行
    expect(canAutoDecide(access, w.sample, w.review, "staff", { id: "pe-s1" })).toBe(true);
    expect(canAutoDecide(access, w.sample, w.review, "manager", { id: "pe-m1" })).toBe(true);
    expect(canAutoDecide(access, w.sample, w.review, "staff", { id: "pr-s1" })).toBe(false);

    // 只有一端核准
    await autoEntity(w.db, "staff", "pe-s2");
    w.review.decisions.push({ item: "pe-s2", decision: "approve" });
    await check();
    await autoEntity(w.db, "staff", "pe-s1");
    w.review.decisions.push({ item: "pe-s1", decision: "approve" });
    expect(canAutoDecide(access, w.sample, w.review, "staff", { id: "pr-s1" })).toBe(true);
    await check();
    await w.db.close();
  });

  it("後面批次的標示（0017）：上傳者只能為自己文件的待審項目新增，不能修改、刪除；有標示的項目不能直接收錄（#404）", async () => {
    const w = await setup();
    const mark = (id: string | null, doc: string, added: { entity?: string; relation?: string }) =>
      writePending(w.db, id, doc, { entities: [], relations: [], addedSources: [{ ...added, passages: [], unsure: "same_name" }] });
    // 別人的文件、別人的項目（文件不符由外鍵拒絕）、沒有身分 → 拒絕
    await expect(mark("staff", w.dm, { entity: "pe-m1" })).rejects.toMatchObject({ reason: "denied" });
    await expect(mark("staff", w.ds, { entity: "pe-m1" })).rejects.toMatchObject({ reason: "denied" });
    await expect(mark("manager", w.ds, { entity: "pe-s1" })).rejects.toMatchObject({ reason: "denied" });
    await expect(mark(null, w.ds, { entity: "pe-s1" })).rejects.toMatchObject({ reason: "denied" });
    expect(await tryAuto(w.db, "staff", "pe-s2")).toBe(true);
    expect(await tryAuto(w.db, "manager", "pe-m1")).toBe(true);

    await mark("staff", w.ds, { entity: "pe-s2" });
    await mark("staff", w.ds, { relation: "pr-s1" });
    await mark("manager", w.dm, { entity: "pe-m1" });
    w.review.pendingEntities.filter((e) => e.id === "pe-s2" || e.id === "pe-m1").forEach((e) => (e.laterUnsure = true));
    w.review.pendingRelations.find((r) => r.id === "pr-s1")!.laterUnsure = true;
    for (const id of IDENTITIES) {
      expect(await queryReview(w.db, id), String(id)).toEqual(sorted(expectedReviewVisible(access, w.sample, w.review, id)));
    }
    expect(expectedReviewVisible(access, w.sample, w.review, "staff").pending_entity_unsure).toEqual(["pe-s2"]);

    // 只能新增
    for (const sql of ["UPDATE kk.pending_entity_unsure SET unsure = 'other'", "DELETE FROM kk.pending_entity_unsure", "DELETE FROM kk.pending_relation_unsure"]) {
      await expect(w.db.withIdentity("staff", (tx) => tx.query(sql)), sql).rejects.toThrow(/permission denied/);
    }

    // 資料庫端的直接收錄檢查：有標示的實體與關係被拒絕（關係在兩端核准後仍被拒絕）
    expect(await tryAuto(w.db, "staff", "pe-s2")).toBe(false);
    expect(await tryAuto(w.db, "manager", "pe-m1")).toBe(false);
    await autoEntity(w.db, "staff", "pe-s1");
    await w.db.withIdentity("manager", async (tx) => {
      await tx.query("INSERT INTO kk.review_decisions (item_id, round, decision, decided_by) VALUES ('pe-s2', kk.next_round('pe-s2'), 'approve', 'manager')");
    });
    expect(await tryAuto(w.db, "staff", "pr-s2")).toBe(true);
    expect(await tryAuto(w.db, "staff", "pr-s1")).toBe(false);
    await w.db.close();
  });

  it("合併到類型不同的實體被拒絕；同一個項目不能有兩筆有效的決定", async () => {
    const w = await setup();
    expect(await tryAuto(w.db, "staff", "pe-s1", "team-rd")).toBe(false);
    await autoEntity(w.db, "staff", "pe-s1", "person-lin-zhiming-rd");
    expect(await tryAuto(w.db, "staff", "pe-s1")).toBe(false);
    await expect(approve(w.db, "manager", { entities: [{ id: "pe-s1" }], relations: [] }, { defaultLanguage: "zh-TW" })).rejects.toMatchObject({ reason: "conflict" });
    await w.db.close();
  });

  it("直接收錄後圖譜與 oracle 一致、待審資料表的可見範圍不變；審核者撤回（附理由）後消失，上傳者不能撤回", async () => {
    const w = await setup();
    await autoEntity(w.db, "staff", "pe-s1");
    await autoEntity(w.db, "staff", "pe-s2");
    await autoRelation(w.db, "staff", "pr-s1");
    w.review.decisions.push({ item: "pe-s1", decision: "approve" }, { item: "pe-s2", decision: "approve" }, { item: "pr-s1", decision: "approve" });
    for (const id of IDENTITIES) {
      expect(await graphKeys(w.db, id), String(id)).toEqual(expectedGraph(w, id));
      expect(await queryReview(w.db, id), String(id)).toEqual(sorted(expectedReviewVisible(access, w.sample, w.review, id)));
    }
    expect((await graphKeys(w.db, "staff")).relations).toContain("pr-s1");
    expect((await graphKeys(w.db, "guest")).entities).not.toContain("pe-s1");

    const modes = await w.db.withIdentity("manager", async (tx) =>
      (await tx.query<{ item_id: string; mode: string }>("SELECT item_id, mode FROM kk.review_decisions WHERE item_id LIKE 'p_-s%' ORDER BY item_id")).rows,
    );
    expect(modes).toEqual([
      { item_id: "pe-s1", mode: "auto" },
      { item_id: "pe-s2", mode: "auto" },
      { item_id: "pr-s1", mode: "auto" },
    ]);

    await expect(retract(w.db, "staff", ["pr-s1"])).rejects.toMatchObject({ reason: "denied" });
    await w.db.withIdentity("manager", (tx) =>
      tx.query("INSERT INTO kk.review_retractions (decision_id, document_id, retracted_by, reason) VALUES ('pr-s1', $1, 'manager', 'relation')", [w.ds]),
    );
    w.review.retractions.push("pr-s1");
    for (const id of IDENTITIES) expect(await graphKeys(w.db, id), String(id)).toEqual(expectedGraph(w, id));
    expect((await graphKeys(w.db, "staff")).relations).not.toContain("pr-s1");
    await w.db.close();
  });
});

describe("偽造的直接收錄", { timeout: 60_000 }, () => {
  const run = (db: Database, id: string | null, sql: string, params: unknown[] = []) => db.withIdentity(id, (tx) => tx.query(sql, params));

  it("沒有 canReview 的上傳者不能寫 manual 決定、替別人寫決定、帶名稱、說明或退回", async () => {
    const w = await setup();
    await expect(run(w.db, "staff", "INSERT INTO kk.review_decisions (item_id, decision, decided_by) VALUES ('pe-s1', 'approve', 'staff')")).rejects.toThrow(/row-level security/);
    await expect(run(w.db, "staff", "INSERT INTO kk.review_decisions (item_id, decision, decided_by, mode) VALUES ('pe-s1', 'approve', 'manager', 'auto')")).rejects.toThrow(/row-level security/);
    for (const sql of [
      `INSERT INTO kk.review_decisions (item_id, decision, decided_by, mode, names) VALUES ('pe-s1', 'approve', 'staff', 'auto', '{"zh-TW":"改","en":"x"}')`,
      "INSERT INTO kk.review_decisions (item_id, decision, decided_by, mode, note) VALUES ('pe-s1', 'approve', 'staff', 'auto', '說明')",
      "INSERT INTO kk.review_decisions (item_id, decision, decided_by, mode) VALUES ('pe-s1', 'reject', 'staff', 'auto')",
    ]) {
      await expect(run(w.db, "staff", sql), sql).rejects.toThrow(/check constraint/);
    }
    // mode 只有 manual、auto：兩條 policy 都不成立，RLS 先拒絕
    await expect(run(w.db, "staff", "INSERT INTO kk.review_decisions (item_id, decision, decided_by, mode) VALUES ('pe-s1', 'approve', 'staff', 'other')")).rejects.toThrow(
      /row-level security|check constraint/,
    );
    // 審核者寫 auto 決定也要是上傳者（主管不是一般員工文件的上傳者）
    expect(await tryAuto(w.db, "manager", "pe-s1")).toBe(false);
    await w.db.close();
  });

  it("正式資料只能依自己寫的 auto 決定寫入，名稱、類型、出處與兩端都要與待審一致", async () => {
    const w = await setup();
    // 主管人工核准一般員工文件的 pe-s2：一般員工不能依這筆決定寫入
    await w.db.withIdentity("manager", (tx) => tx.query("INSERT INTO kk.review_decisions (item_id, decision, decided_by) VALUES ('pe-s2', 'approve', 'manager')"));
    await expect(
      run(w.db, "staff", `INSERT INTO kk.entities (id, entity_type, name, names) VALUES ('pe-s2', 'project', '青翼專案', '{"zh-TW":"青翼專案","en":"Project Bluewing"}')`),
    ).rejects.toThrow(/row-level security/);

    const decide = (sql: string, params: unknown[] = []) =>
      w.db.withIdentity("staff", async (tx) => {
        await tx.query(autoSql, ["pe-s1", "staff", null]);
        await tx.query(sql, params);
      });
    for (const sql of [
      `INSERT INTO kk.entities (id, entity_type, name, names) VALUES ('pe-s1', 'person', '別人', '{"zh-TW":"別人","en":"Someone"}')`,
      `INSERT INTO kk.entities (id, entity_type, name, names) VALUES ('pe-s1', 'team', '林志明', '{"zh-TW":"林志明","en":"Zhiming Lin"}')`,
      `INSERT INTO kk.entities (id, entity_type, name, names) VALUES ('pe-s1', 'person', '別人', '{"zh-TW":"林志明","en":"Zhiming Lin"}')`,
      "INSERT INTO kk.entity_sources (entity_id, passage_id, decision_id) VALUES ('pe-s1', 'bluewing-kickoff-zh-01', 'pe-s1')",
      "INSERT INTO kk.entity_sources (entity_id, passage_id, decision_id) SELECT 'person-lin-zhiming-rd', passage_id, 'pe-s1' FROM kk.pending_entity_sources WHERE pending_entity_id = 'pe-s1'",
    ]) {
      await expect(decide(sql), sql).rejects.toThrow(/row-level security/);
    }

    // 關係：兩端核准後，類型或兩端與待審不同
    await autoEntity(w.db, "staff", "pe-s1");
    for (const sql of [
      "INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id) VALUES ('pr-s1', 'member-of', 'pe-s1', 'pe-s2')",
      "INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id) VALUES ('pr-s1', 'leads', 'pe-s1', 'project-bluewing')",
    ]) {
      await expect(
        w.db.withIdentity("staff", async (tx) => {
          await tx.query(autoSql, ["pr-s1", "staff", null]);
          await tx.query(sql);
        }),
        sql,
      ).rejects.toThrow(/row-level security/);
    }
    await w.db.close();
  });

  it("新欄位的值受 CHECK 限制：unsure、撤回理由、說明的長度", async () => {
    const w = await setup();
    await expect(
      run(w.db, "staff", `INSERT INTO kk.pending_entities (id, document_id, entity_type, names, unsure) VALUES ('pe-s9', $1, 'team', '{"zh-TW":"x","en":"x"}', 'maybe')`, [w.ds]),
    ).rejects.toThrow(/check constraint/);
    await expect(run(w.db, "manager", "INSERT INTO kk.review_decisions (item_id, decision, decided_by, note) VALUES ('pe-m1', 'approve', 'manager', '')")).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      run(w.db, "manager", "INSERT INTO kk.review_decisions (item_id, decision, decided_by, note) VALUES ('pe-m1', 'approve', 'manager', $1)", ["字".repeat(501)]),
    ).rejects.toThrow(/check constraint/);
    await run(w.db, "manager", "INSERT INTO kk.review_decisions (item_id, decision, decided_by, note) VALUES ('pe-m1', 'reject', 'manager', '不是這位')");
    await expect(
      run(w.db, "manager", "INSERT INTO kk.review_retractions (decision_id, document_id, retracted_by, reason) VALUES ('pe-m1', $1, 'manager', 'typo')", [w.dm]),
    ).rejects.toThrow(/check constraint/);
    await run(w.db, "manager", "INSERT INTO kk.review_retractions (decision_id, document_id, retracted_by, reason) VALUES ('pe-m1', $1, 'manager', 'exclude')", [w.dm]);
    await w.db.close();
  });
});
