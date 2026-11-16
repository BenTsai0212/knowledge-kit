// 請上傳者確認的權限（ADR 0011 決定 6，migration 0016）：以 oracle.ts 比對每個身分 × 每個項目能否寫入請求、
// 每個身分 × 每個請求能否回答，以及每個身分看得到的請求與回答；兩種設定（參考情境，以及一般員工也能審核）。
// 另測試偽造的寫入、欄位的限制、kk_app 沒有 UPDATE、DELETE，以及「忽略身分的資料層」的反向驗證
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import type { ClientConfig } from "../../src/client/types";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { MAX_REPLY_NOTE_CHARS, readRequests, replyToRequest, requestUploader } from "../../src/extraction/requests";
import { approve, reject, writePending } from "../../src/extraction/store";
import { uploadDocument } from "../../src/upload/write";
import { datasetSample } from "../db/dataset-sample";
import { canReply, canRequest, expectedRequestVisible, expectedVisible, REQUEST_KEY_SQL, type RequestSample, type ReviewSample } from "../db/oracle";
import type { Sample } from "../db/sample";

const IDENTITIES = ["guest", "staff", "manager", null, "nobody"];
const OPTIONS = { languages: clientConfig.client.languages };
const staffReviews: ClientConfig = {
  ...clientConfig,
  access: { ...clientConfig.access, roles: clientConfig.access.roles.map((r) => (r.id === "staff" ? { ...r, canReview: true } : r)) },
};

// 資料集的實體：一般員工看得到的一位人員；只有主管看得到的一個實體（pe-m1 用它的類型），以及一個類型不同、一般員工看得到的實體
const visible = (id: string) => new Set(expectedVisible(clientConfig.access, datasetSample, id).entities);
const ENTITIES = dataset.entities.entities;
const STAFF_PERSON = ENTITIES.find((e) => e.type === "person" && visible("staff").has(e.id))!.id;
const MANAGER_ONLY = ENTITIES.find((e) => visible("manager").has(e.id) && !visible("staff").has(e.id))!;
const OTHER_TYPE = ENTITIES.find((e) => e.type !== MANAGER_ONLY.type && visible("staff").has(e.id))!.id;

interface World {
  db: Database;
  config: ClientConfig;
  sample: Sample;
  review: ReviewSample;
  requests: RequestSample;
}

// 一般員工上傳一份青翼專案的內部文件（pe-s1、pe-s2、pr-s1）與一份公開文件（pe-p1），主管上傳一份青翼專案的內部文件（pe-m1）與一份機密文件（pe-c1）。內容虛構
async function setup(config: ClientConfig): Promise<World> {
  const db = await openDatabase(config, { seed: (pg) => seedDataset(pg, config, dataset) });
  const doc = (by: string, visibility: string, project: string | null, text: string) =>
    uploadDocument(db, by, { title: "測試文件（虛構）", language: "zh-TW", visibility, project, date: "2026-10-02", passages: [text] }, OPTIONS);
  const ds = await doc("staff", "internal", "bluewing", "測試人員甲帶領青翼專案的使用者測試。");
  const dm = await doc("manager", "internal", "bluewing", "測試人員乙加入青翼專案。");
  const dc = await doc("manager", "confidential", null, "測試人員丙調到營運部。");
  // 訪客看得到這份公開文件，但不是審核者也不是上傳者，所以讀不到它的請求
  const dp = await doc("staff", "public", null, "測試人員丁到職。");
  const person = (id: string, name: string, p: string) => ({ id, type: "person", names: { "zh-TW": name, en: name }, sources: [p] });
  const [ps, pm, pc, pp] = [ds.passageIds[0], dm.passageIds[0], dc.passageIds[0], dp.passageIds[0]];
  await writePending(db, "staff", ds.documentId, {
    entities: [person("pe-s1", "測試人員甲", ps), { ...person("pe-s2", "青翼專案", ps), type: "project" }],
    relations: [{ id: "pr-s1", type: "leads", from: "pe-s1", to: "pe-s2", sources: [ps] }],
  });
  await writePending(db, "manager", dm.documentId, { entities: [{ ...person("pe-m1", "測試人員乙", pm), type: MANAGER_ONLY.type }], relations: [] });
  await writePending(db, "manager", dc.documentId, { entities: [person("pe-c1", "測試人員丙", pc)], relations: [] });
  await writePending(db, "staff", dp.documentId, { entities: [person("pe-p1", "測試人員丁", pp)], relations: [] });
  const sample: Sample = {
    ...datasetSample,
    docs: [
      ...datasetSample.docs,
      { id: ds.documentId, level: "internal", project: "bluewing" },
      { id: dm.documentId, level: "internal", project: "bluewing" },
      { id: dc.documentId, level: "confidential", project: null },
      { id: dp.documentId, level: "public", project: null },
    ],
    passages: [
      ...datasetSample.passages,
      { id: ps, doc: ds.documentId, level: "internal", project: "bluewing" },
      { id: pm, doc: dm.documentId, level: "internal", project: "bluewing" },
      { id: pc, doc: dc.documentId, level: "confidential", project: null },
      { id: pp, doc: dp.documentId, level: "public", project: null },
    ],
  };
  const review: ReviewSample = {
    uploads: { [ds.documentId]: "staff", [dm.documentId]: "manager", [dc.documentId]: "manager", [dp.documentId]: "staff" },
    pendingEntities: [
      { id: "pe-s1", doc: ds.documentId, type: "person", sources: [ps] },
      { id: "pe-s2", doc: ds.documentId, type: "project", sources: [ps] },
      { id: "pe-m1", doc: dm.documentId, type: MANAGER_ONLY.type, sources: [pm] },
      { id: "pe-c1", doc: dc.documentId, type: "person", sources: [pc] },
      { id: "pe-p1", doc: dp.documentId, type: "person", sources: [pp] },
    ],
    pendingRelations: [{ id: "pr-s1", doc: ds.documentId, from: "pe-s1", to: "pe-s2", sources: [ps] }],
    decisions: [],
    retractions: [],
  };
  return { db, config, sample, review, requests: { requests: [], replies: [] } };
}

const ITEMS = ["pe-s1", "pe-s2", "pr-s1", "pe-p1", "pe-m1", "pe-c1", "pe-none"];

const query = (db: Database, id: string | null) =>
  db.withIdentity(id, async (tx) => {
    const out: Record<string, string[]> = {};
    for (const [table, key] of Object.entries(REQUEST_KEY_SQL)) {
      out[table] = (await tx.query<{ k: string }>(`SELECT ${key} AS k FROM kk.${table}`)).rows.map((r) => r.k).sort();
    }
    return out;
  });
const sorted = (v: Record<string, string[]>) => Object.fromEntries(Object.entries(v).map(([k, list]) => [k, [...list].sort()]));

async function expectVisibleMatchesOracle(w: World) {
  for (const id of IDENTITIES) {
    const expected = expectedRequestVisible(w.config.access, w.sample, w.review, w.requests, id);
    expect(await query(w.db, id), String(id)).toEqual(sorted(expected));
    const read = await readRequests(w.db, id);
    expect(read.map((q) => q.id).sort(), `readRequests ${id}`).toEqual([...expected.review_requests].sort());
    expect(read.filter((q) => q.reply !== null).map((q) => q.id).sort(), `readRequests 的回答 ${id}`).toEqual([...expected.review_request_replies].sort());
  }
}

// 每個身分 × 每個項目寫入請求，與 oracle 比對；回傳允許的筆數
async function requestAll(w: World): Promise<number> {
  let allowed = 0;
  for (const id of IDENTITIES) {
    for (const item of ITEMS) {
      const expected = canRequest(w.config.access, w.sample, w.review, w.requests, id, item);
      const result = requestUploader(w.db, id, item);
      if (expected) {
        allowed++;
        w.requests.requests.push({ id: await result, item, by: id! });
      } else {
        await expect(result, `${id} ${item}`).rejects.toMatchObject({ reason: "denied" });
      }
    }
  }
  return allowed;
}

for (const [label, config] of [
  ["參考情境", clientConfig],
  ["一般員工也能審核", staffReviews],
] as const) {
  describe(`請求與回答（${label}）`, { timeout: 60_000 }, () => {
    it("每個身分 × 每個項目能否請求、每個身分 × 每個請求能否回答，與看得到的列，正好等於 oracle", async () => {
      const w = await setup(config);
      const requested = await requestAll(w);
      // 防止以全部拒絕而通過。參考情境：主管對一般員工的 4 項。一般員工也能審核時，另加一般員工對主管的內部文件 1 項（看不到機密文件）
      expect(requested).toBe(label === "參考情境" ? 4 : 5);
      // 同一個項目還有沒回答的請求時，不能再請求
      for (const q of w.requests.requests) await expect(requestUploader(w.db, q.by, q.item)).rejects.toMatchObject({ reason: "denied" });
      await expectVisibleMatchesOracle(w);

      let replied = 0;
      for (const id of IDENTITIES) {
        for (const q of [...w.requests.requests]) {
          const expected = canReply(w.config.access, w.sample, w.review, w.requests, id, q.id);
          const result = replyToRequest(w.db, id, q.id, { choice: "keep" });
          if (expected) {
            replied++;
            await result;
            w.requests.replies.push({ request: q.id });
          } else {
            await expect(result, `${id} ${q.item}`).rejects.toMatchObject({ reason: expect.stringMatching(/^(denied|conflict)$/) });
          }
        }
      }
      expect(replied).toBe(requested);
      await expectVisibleMatchesOracle(w);

      // 回答後，審核者可以再請求一次
      const again = w.requests.requests[0];
      expect(canRequest(w.config.access, w.sample, w.review, w.requests, again.by, again.item)).toBe(true);
      w.requests.requests.push({ id: await requestUploader(w.db, again.by, again.item), item: again.item, by: again.by });
      await expectVisibleMatchesOracle(w);
      await w.db.close();
    });
  });
}

describe("合併的回答", { timeout: 60_000 }, () => {
  it("合併對象：自己看得到、類型相同的實體；讀者看不到合併對象時讀不到該回答", async () => {
    // 一般員工也能審核：一般員工請主管確認主管的內部文件
    const w = await setup(staffReviews);
    const rq = await requestUploader(w.db, "staff", "pe-m1");
    w.requests.requests.push({ id: rq, item: "pe-m1", by: "staff" });
    const reply = (mergeInto: string) => replyToRequest(w.db, "manager", rq, { choice: "merge", mergeInto });
    expect(canReply(w.config.access, w.sample, w.review, w.requests, "manager", rq, { id: OTHER_TYPE, sameType: false })).toBe(false);
    await expect(reply(OTHER_TYPE)).rejects.toMatchObject({ reason: "denied" });
    await expect(reply("no-such-entity")).rejects.toMatchObject({ reason: "denied" });
    await expect(replyToRequest(w.db, "manager", rq, { choice: "merge" })).rejects.toMatchObject({ reason: "denied" });
    expect(canReply(w.config.access, w.sample, w.review, w.requests, "manager", rq, { id: MANAGER_ONLY.id, sameType: true })).toBe(true);
    await reply(MANAGER_ONLY.id);
    w.requests.replies.push({ request: rq, mergeInto: MANAGER_ONLY.id });
    await expectVisibleMatchesOracle(w);
    // 一般員工讀得到請求，但讀不到合併到他看不到的實體的回答
    expect((await readRequests(w.db, "staff")).find((q) => q.id === rq)?.reply).toBeNull();
    expect((await readRequests(w.db, "manager")).find((q) => q.id === rq)?.reply).toMatchObject({ choice: "merge", mergeInto: MANAGER_ONLY.id, repliedBy: "manager" });
    await w.db.close();
  });

  it("上傳者看不到的實體不能當合併對象；關係不能合併或建立新實體", async () => {
    const w = await setup(clientConfig);
    const rq = await requestUploader(w.db, "manager", "pe-s1");
    const rel = await requestUploader(w.db, "manager", "pr-s1");
    await expect(replyToRequest(w.db, "staff", rq, { choice: "merge", mergeInto: MANAGER_ONLY.id })).rejects.toMatchObject({ reason: "denied" });
    await expect(replyToRequest(w.db, "staff", rel, { choice: "merge", mergeInto: STAFF_PERSON })).rejects.toMatchObject({ reason: "denied" });
    await expect(replyToRequest(w.db, "staff", rel, { choice: "new" })).rejects.toMatchObject({ reason: "denied" });
    await replyToRequest(w.db, "staff", rq, { choice: "merge", mergeInto: STAFF_PERSON });
    await replyToRequest(w.db, "staff", rel, { choice: "reject" });
    const read = await readRequests(w.db, "manager");
    expect(read.map((q) => [q.itemId, q.reply?.choice, q.reply?.mergeInto, q.mine, q.decided])).toEqual([
      ["pe-s1", "merge", STAFF_PERSON, false, false],
      ["pr-s1", "reject", null, false, false],
    ]);
    expect((await readRequests(w.db, "staff")).every((q) => q.mine)).toBe(true);
    await w.db.close();
  });
});

describe("欄位與決定", { timeout: 60_000 }, () => {
  it("說明只用於 other、空白視為沒有、長度上限；同一個請求回答兩次是 conflict", async () => {
    const w = await setup(clientConfig);
    const rq = await requestUploader(w.db, "manager", "pe-s1");
    await expect(replyToRequest(w.db, "staff", rq, { choice: "other", note: "長".repeat(MAX_REPLY_NOTE_CHARS + 1) })).rejects.toMatchObject({ reason: "denied" });
    const insert = (values: string) =>
      w.db.withIdentity("staff", (tx) => tx.exec(`INSERT INTO kk.review_request_replies (request_id, replied_by, choice, note) VALUES ${values}`));
    await expect(insert(`('${rq}', 'staff', 'keep', '說明只用於 other')`)).rejects.toThrow(/check constraint/);
    await expect(insert(`('${rq}', 'staff', 'maybe', NULL)`)).rejects.toThrow(/check constraint/);
    await replyToRequest(w.db, "staff", rq, { choice: "other", note: "   " });
    await expect(replyToRequest(w.db, "staff", rq, { choice: "keep" })).rejects.toMatchObject({ reason: "conflict" });
    expect((await readRequests(w.db, "staff"))[0].reply).toMatchObject({ choice: "other", note: null, repliedBy: "staff" });
    await w.db.close();
  });

  it("項目已有決定時不能請求、不能回答；readRequests 標示 decided", async () => {
    const w = await setup(clientConfig);
    const rq = await requestUploader(w.db, "manager", "pe-s1");
    await approve(w.db, "manager", { entities: [{ id: "pe-s1" }], relations: [] }, { defaultLanguage: clientConfig.client.defaultLanguage });
    await expect(replyToRequest(w.db, "staff", rq, { choice: "keep" })).rejects.toMatchObject({ reason: "denied" });
    await expect(requestUploader(w.db, "manager", "pe-s1")).rejects.toMatchObject({ reason: "denied" });
    // 沒有請求過、已有決定的項目
    await reject(w.db, "manager", { entities: ["pe-p1"], relations: [] });
    await expect(requestUploader(w.db, "manager", "pe-p1")).rejects.toMatchObject({ reason: "denied" });
    expect((await readRequests(w.db, "manager"))[0]).toMatchObject({ itemId: "pe-s1", decided: true, reply: null });
    await w.db.close();
  });

  it("偽造的寫入被拒絕：請求者或回答者是別人、時間不是現在、項目不屬於該文件、回答別人的文件", async () => {
    const w = await setup(clientConfig);
    const docOf = (item: string) => [...w.review.pendingEntities, ...w.review.pendingRelations].find((x) => x.id === item)!.doc;
    const request = (identity: string, values: string) =>
      w.db.withIdentity(identity, (tx) => tx.exec(`INSERT INTO kk.review_requests (id, item_id, document_id, requested_by, requested_at) VALUES ${values}`));
    const [ds, dm, dp] = [docOf("pe-s1"), docOf("pe-m1"), docOf("pe-p1")];
    await expect(request("manager", `('rq-f1', 'pe-s1', '${ds}', 'staff', now())`)).rejects.toThrow(/row-level security/);
    await expect(request("manager", `('rq-f2', 'pe-s1', '${ds}', 'manager', now() - interval '1 day')`)).rejects.toThrow(/row-level security/);
    await expect(request("manager", `('rq-f3', 'pe-s1', '${dm}', 'manager', now())`)).rejects.toThrow(/row-level security/);
    // 項目屬於一般員工的另一份文件
    await expect(request("manager", `('rq-f3b', 'pe-s1', '${dp}', 'manager', now())`)).rejects.toThrow(/row-level security/);
    await expect(request("manager", `('x-f4', 'pe-s1', '${ds}', 'manager', now())`)).rejects.toThrow(/check constraint/);
    await expect(request("staff", `('rq-f5', 'pe-m1', '${dm}', 'staff', now())`)).rejects.toThrow(/row-level security/);
    await expect(request("manager", `('rq-ok', 'pe-s1', '${ds}', 'manager', now())`)).resolves.toBeDefined();
    const reply = (identity: string, values: string) =>
      w.db.withIdentity(identity, (tx) => tx.exec(`INSERT INTO kk.review_request_replies (request_id, replied_by, choice, replied_at) VALUES ${values}`));
    await expect(reply("staff", `('rq-ok', 'manager', 'keep', now())`)).rejects.toThrow(/row-level security/);
    await expect(reply("staff", `('rq-ok', 'staff', 'keep', now() - interval '1 day')`)).rejects.toThrow(/row-level security/);
    // 主管看得到該文件，但不是上傳者
    await expect(reply("manager", `('rq-ok', 'manager', 'keep', now())`)).rejects.toThrow(/row-level security/);
    await expect(reply("staff", `('rq-ok', 'staff', 'keep', now())`)).resolves.toBeDefined();
    await w.db.close();
  });
});

describe("反向驗證與 kk_app 的權限", { timeout: 60_000 }, () => {
  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const w = await setup(clientConfig);
    await requestAll(w);
    const ignoring: Database = { withIdentity: (_id, fn) => w.db.withIdentity("manager", fn), close: w.db.close };
    for (const id of ["guest", null]) {
      expect(await query(ignoring, id), String(id)).not.toEqual(sorted(expectedRequestVisible(w.config.access, w.sample, w.review, w.requests, id)));
    }
    await w.db.close();
  });

  it("新資料表只有 SELECT、INSERT，沒有 UPDATE、DELETE", async () => {
    const w = await setup(clientConfig);
    for (const table of Object.keys(REQUEST_KEY_SQL)) {
      const privileges = await w.db.withIdentity("manager", async (tx) =>
        (
          await tx.query<{ p: string; ok: boolean }>(
            `SELECT p, has_table_privilege('kk_app', 'kk.${table}', p) AS ok FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p`,
          )
        ).rows,
      );
      for (const r of privileges) expect(r.ok, `${table} ${r.p}`).toBe(r.p === "SELECT" || r.p === "INSERT");
      for (const sql of [`UPDATE kk.${table} SET ${REQUEST_KEY_SQL[table]} = 'x'`, `DELETE FROM kk.${table}`]) {
        await expect(w.db.withIdentity("manager", (tx) => tx.exec(sql)), sql).rejects.toThrow(/permission denied/);
      }
    }
    await w.db.close();
  });
});
