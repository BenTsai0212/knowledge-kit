// 說法不同的權限（#51）：以 oracle.ts 比對每個身分看得到的偵測結果與決定、能寫入與能處理的組合，
// 並以「忽略身分的資料層」做反向驗證。另以「一般員工也能審核」的設定，測試核准者只能處理兩段都看得到的組合。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import type { ClientConfig } from "../../src/client/types";
import { decideConflict, readConflicts, writeConflicts, type ConflictDecision } from "../../src/conflicts/store";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { ReviewError } from "../../src/extraction/store";
import { uploadDocument } from "../../src/upload/write";
import { datasetSample } from "../db/dataset-sample";
import { canDecideConflict, canWriteConflict, CONFLICT_KEY_SQL, expectedConflictVisible, type ConflictSample } from "../db/oracle";
import type { Sample } from "../db/sample";

const IDENTITIES = ["guest", "staff", "manager", null, "nobody"];
const OPTIONS = { languages: clientConfig.client.languages };
const STAFF_REVIEWS: ClientConfig = {
  ...clientConfig,
  access: { ...clientConfig.access, roles: clientConfig.access.roles.map((r) => (r.id === "staff" ? { ...r, canReview: true } : r)) },
};

// 資料集的既有段落：公開、公開、青翼內部、機密、長堤內部
const PUBLIC = "employee-handbook-zh-01";
const PUBLIC2 = "employee-handbook-zh-02";
const BLUEWING = "bluewing-kickoff-zh-01";
const CONFIDENTIAL = "reorg-2026-zh-01";
const LONGPIER = "longpier-progress-zh-01";

interface World {
  db: Database;
  config: ClientConfig;
  sample: Sample;
  conflicts: ConflictSample;
  // 主管上傳的機密文件、一般員工上傳的青翼內部文件與公開文件
  dm: { documentId: string; passageIds: string[] };
  ds: { documentId: string; passageIds: string[] };
  dp: { documentId: string; passageIds: string[] };
}

type Pair = { id: string; doc: "dm" | "ds" | "dp"; newIndex: number; oldPassage: string; decision?: ConflictDecision };

// 寫入的偵測結果與主管的決定（內容虛構）
const PAIRS: Pair[] = [
  { id: "pc-m1", doc: "dm", newIndex: 0, oldPassage: PUBLIC, decision: "supersede" },
  { id: "pc-m2", doc: "dm", newIndex: 1, oldPassage: BLUEWING, decision: "not_conflict" },
  { id: "pc-s1", doc: "ds", newIndex: 0, oldPassage: BLUEWING, decision: "coexist" },
  { id: "pc-s2", doc: "ds", newIndex: 0, oldPassage: PUBLIC },
  { id: "pc-p1", doc: "dp", newIndex: 0, oldPassage: PUBLIC, decision: "coexist" },
  { id: "pc-p2", doc: "dp", newIndex: 0, oldPassage: PUBLIC2, decision: "not_conflict" },
];

async function setup(config: ClientConfig = clientConfig, options: { pairs?: boolean } = {}): Promise<World> {
  const db = await openDatabase(config, { seed: (pg) => seedDataset(pg, config, dataset) });
  const upload = (identity: string, title: string, visibility: string, project: string | null, passages: string[]) =>
    uploadDocument(db, identity, { title, language: "zh-TW", visibility, project, date: "2026-10-20", passages }, OPTIONS);
  const dm = await upload("manager", "上班時間調整（虛構）", "confidential", null, ["上班時間改為十點到七點。", "青翼專案延到第四季。"]);
  const ds = await upload("staff", "青翼進度（虛構）", "internal", "bluewing", ["青翼專案延到第三季。", "測試由研發部負責。"]);
  const dp = await upload("staff", "公告（虛構）", "public", null, ["上班時間維持九點到六點。"]);
  const docs = { dm, ds, dp };

  const sample: Sample = {
    ...datasetSample,
    docs: [
      ...datasetSample.docs,
      { id: dm.documentId, level: "confidential", project: null },
      { id: ds.documentId, level: "internal", project: "bluewing" },
      { id: dp.documentId, level: "public", project: null },
    ],
    passages: [
      ...datasetSample.passages,
      ...dm.passageIds.map((id) => ({ id, doc: dm.documentId, level: "confidential", project: null })),
      ...ds.passageIds.map((id) => ({ id, doc: ds.documentId, level: "internal", project: "bluewing" })),
      ...dp.passageIds.map((id) => ({ id, doc: dp.documentId, level: "public", project: null })),
    ],
  };
  const conflicts: ConflictSample = {
    uploads: { [dm.documentId]: "manager", [ds.documentId]: "staff", [dp.documentId]: "staff" },
    conflicts: [],
    decisions: [],
  };
  const w = { db, config, sample, conflicts, dm, ds, dp };
  if (options.pairs === false) return w;

  const uploader = { dm: "manager", ds: "staff", dp: "staff" } as const;
  for (const doc of ["dm", "ds", "dp"] as const) {
    const pairs = PAIRS.filter((p) => p.doc === doc).map((p) => ({
      id: p.id,
      newPassage: docs[doc].passageIds[p.newIndex],
      oldPassage: p.oldPassage,
      summary: `差異說明 ${p.id}`,
    }));
    await writeConflicts(db, uploader[doc], docs[doc].documentId, pairs);
    conflicts.conflicts.push(...pairs.map((p) => ({ id: p.id, doc: docs[doc].documentId, newPassage: p.newPassage, oldPassage: p.oldPassage })));
  }
  for (const p of PAIRS.filter((p) => p.decision !== undefined)) {
    await decideConflict(db, "manager", p.id, p.decision!);
    conflicts.decisions.push({ conflict: p.id, decision: p.decision! });
  }
  return w;
}

const queryConflicts = (db: Database, id: string | null) =>
  db.withIdentity(id, async (tx) => {
    const out: Record<string, string[]> = {};
    for (const [table, key] of Object.entries(CONFLICT_KEY_SQL)) {
      out[table] = (await tx.query<{ k: string }>(`SELECT ${key} AS k FROM kk.${table}`)).rows.map((r) => r.k).sort();
    }
    return out;
  });
const sorted = (v: Record<string, string[]>) => Object.fromEntries(Object.entries(v).map(([k, list]) => [k, [...list].sort()]));

describe("測試資料的前提", () => {
  it("既有段落的可見等級與專案符合預期", () => {
    const level = (id: string) => datasetSample.passages.find((p) => p.id === id);
    expect(level(PUBLIC)).toMatchObject({ level: "public", project: null });
    expect(level(PUBLIC2)).toMatchObject({ level: "public", project: null });
    expect(level(BLUEWING)).toMatchObject({ level: "internal", project: "bluewing" });
    expect(level(CONFIDENTIAL)).toMatchObject({ level: "confidential" });
    expect(level(LONGPIER)).toMatchObject({ level: "internal", project: "longpier" });
  });
});

describe.each([
  ["參考設定（只有主管審核）", clientConfig],
  ["一般員工也能審核", STAFF_REVIEWS],
])("偵測結果與決定的可見範圍：%s", { timeout: 30_000 }, (_name, config) => {
  it("每個身分看得到的列，正好等於 oracle（兩段都看得到，且有 canReview 或決定是並存、取代）", async () => {
    const w = await setup(config);
    for (const id of IDENTITIES) {
      expect(await queryConflicts(w.db, id), String(id)).toEqual(sorted(expectedConflictVisible(config.access, w.sample, w.conflicts, id)));
      expect((await readConflicts(w.db, id)).map((c) => c.id).sort(), `readConflicts ${id}`).toEqual(
        [...expectedConflictVisible(config.access, w.sample, w.conflicts, id).conflicts].sort(),
      );
    }
    // 防止以全部看不到而通過
    expect(expectedConflictVisible(config.access, w.sample, w.conflicts, "manager").conflicts).toHaveLength(6);
    expect(expectedConflictVisible(config.access, w.sample, w.conflicts, "guest").conflicts).toEqual(["pc-p1"]);
    await w.db.close();
  });

  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const w = await setup(config);
    const ignoring: Database = { withIdentity: (_id, fn) => w.db.withIdentity("manager", fn), close: w.db.close };
    for (const id of ["guest", "staff", null]) {
      expect(await queryConflicts(ignoring, id), String(id)).not.toEqual(sorted(expectedConflictVisible(config.access, w.sample, w.conflicts, id)));
    }
    await w.db.close();
  });
});

describe("沒有 canReview 的身分", { timeout: 30_000 }, () => {
  it("看不到未處理與「不算說法不同」的組合，看得到兩段都可見的「並存」「取代」組合", async () => {
    const w = await setup();
    expect((await queryConflicts(w.db, "staff")).conflicts).toEqual(["pc-p1", "pc-s1"]);
    // pc-m1（取代）的新段落在機密文件中，一般員工看不到
    expect((await queryConflicts(w.db, "staff")).conflict_decisions).toEqual(["pc-p1", "pc-s1"]);
    expect((await queryConflicts(w.db, "manager")).conflicts).toEqual(PAIRS.map((p) => p.id).sort());
    await w.db.close();
  });
});

describe("寫入偵測結果（上傳者）", { timeout: 30_000 }, () => {
  it("每個身分 × 文件 × 既有段落能否寫入，正好等於 oracle", async () => {
    const w = await setup(clientConfig, { pairs: false });
    const docs = [
      { doc: w.dm.documentId, newPassage: w.dm.passageIds[0], same: w.dm.passageIds[1] },
      { doc: w.ds.documentId, newPassage: w.ds.passageIds[0], same: w.ds.passageIds[1] },
      { doc: "bluewing-kickoff-zh", newPassage: "bluewing-kickoff-zh-02", same: "bluewing-kickoff-zh-03" },
    ];
    let n = 0;
    let allowed = 0;
    for (const id of IDENTITIES) {
      for (const d of docs) {
        for (const oldPassage of [PUBLIC, BLUEWING, CONFIDENTIAL, LONGPIER, d.same]) {
          const pair = { doc: d.doc, newPassage: d.newPassage, oldPassage };
          const expected = canWriteConflict(clientConfig.access, w.sample, w.conflicts, id, pair);
          const result = writeConflicts(w.db, id, d.doc, [{ id: `pc-w${n++}`, newPassage: d.newPassage, oldPassage, summary: "x" }]);
          const label = `${id} ${d.doc} ${oldPassage}`;
          if (expected) {
            allowed++;
            await expect(result, label).resolves.toBeUndefined();
          } else {
            await expect(result, label).rejects.toMatchObject({ reason: "denied" });
          }
        }
      }
    }
    // 防止以全部拒絕而通過：主管 4 組（不含同一份文件）、一般員工 2 組（公開、青翼）
    expect(allowed).toBe(6);
    await w.db.close();
  });

  it("新段落不屬於該文件、id 格式、說明長度、同一段重複寫入都被拒絕；任何一組被拒絕時整筆不寫入", async () => {
    const w = await setup(clientConfig, { pairs: false });
    const write = (pairs: { id: string; newPassage: string; oldPassage: string; summary: string }[]) => writeConflicts(w.db, "staff", w.ds.documentId, pairs);
    const ok = { id: "pc-ok", newPassage: w.ds.passageIds[0], oldPassage: PUBLIC, summary: "上班時間：九點 → 十點" };
    await expect(write([{ ...ok, newPassage: w.dp.passageIds[0] }])).rejects.toMatchObject({ reason: "denied" });
    await expect(write([{ ...ok, id: "x-1" }])).rejects.toMatchObject({ reason: "denied" });
    await expect(write([{ ...ok, summary: "" }])).rejects.toMatchObject({ reason: "denied" });
    await expect(write([{ ...ok, summary: "長".repeat(201) }])).rejects.toMatchObject({ reason: "denied" });
    await expect(write([ok, { ...ok, id: "pc-bad", oldPassage: CONFIDENTIAL }])).rejects.toMatchObject({ reason: "denied" });
    await expect(write([ok, { ...ok, id: "pc-dup" }])).rejects.toMatchObject({ reason: "conflict" });
    expect((await queryConflicts(w.db, "manager")).conflicts).toEqual([]);
    await write([ok]);
    expect((await queryConflicts(w.db, "manager")).conflicts).toEqual(["pc-ok"]);
    // 寫入後，沒有 canReview 的上傳者讀不到
    expect((await queryConflicts(w.db, "staff")).conflicts).toEqual([]);
    await w.db.close();
  });
});

describe("處理", { timeout: 30_000 }, () => {
  it.each([
    ["參考設定（只有主管審核）", clientConfig],
    ["一般員工也能審核", STAFF_REVIEWS],
  ])("每個身分 × 每一組能否處理，正好等於 oracle：%s", async (_name, config) => {
    const w = await setup(config);
    let allowed = 0;
    for (const id of IDENTITIES) {
      for (const p of PAIRS) {
        const expected = canDecideConflict(config.access, w.sample, w.conflicts, id, p.id);
        // 失敗的嘗試不留下紀錄；成功的嘗試寫入 coexist，之後同一組不能再處理
        const result = decideConflict(w.db, id, p.id, "coexist");
        if (expected) {
          allowed++;
          await expect(result, `${id} ${p.id}`).resolves.toBeUndefined();
          w.conflicts.decisions.push({ conflict: p.id, decision: "coexist" });
        } else {
          await expect(result, `${id} ${p.id}`).rejects.toBeInstanceOf(ReviewError);
        }
      }
    }
    // 只有 pc-s2 尚未處理，主管或（第二種設定中）一般員工先處理
    expect(allowed).toBe(1);
    await w.db.close();
  });

  it("沒有 canReview，或看不到其中一段，不能處理；已處理的組不能再處理", async () => {
    const w = await setup(STAFF_REVIEWS, { pairs: false });
    const pairs = [
      { id: "pc-a", newPassage: w.dm.passageIds[0], oldPassage: PUBLIC, summary: "a" },
      { id: "pc-b", newPassage: w.dm.passageIds[1], oldPassage: BLUEWING, summary: "b" },
    ];
    await writeConflicts(w.db, "manager", w.dm.documentId, pairs);
    await writeConflicts(w.db, "staff", w.ds.documentId, [{ id: "pc-c", newPassage: w.ds.passageIds[0], oldPassage: BLUEWING, summary: "c" }]);
    for (const id of ["guest", null, "nobody"]) {
      await expect(decideConflict(w.db, id, "pc-c", "supersede"), String(id)).rejects.toMatchObject({ reason: "denied" });
    }
    // 一般員工（此設定有 canReview）看不到機密文件的段落
    await expect(decideConflict(w.db, "staff", "pc-a", "supersede")).rejects.toMatchObject({ reason: "denied" });
    await expect(decideConflict(w.db, "staff", "pc-b", "not_conflict")).rejects.toMatchObject({ reason: "denied" });
    await decideConflict(w.db, "staff", "pc-c", "supersede");
    await expect(decideConflict(w.db, "manager", "pc-c", "coexist")).rejects.toMatchObject({ reason: "conflict" });
    await w.db.close();
  });

  it("偽造的決定被拒絕：決定者寫成別人、兩段與偵測結果不一致、不存在的決定、看不到的組", async () => {
    const w = await setup(clientConfig, { pairs: false });
    await writeConflicts(w.db, "staff", w.ds.documentId, [{ id: "pc-c", newPassage: w.ds.passageIds[0], oldPassage: BLUEWING, summary: "c" }]);
    const insert = (identity: string, values: string) =>
      w.db.withIdentity(identity, (tx) =>
        tx.exec(`INSERT INTO kk.conflict_decisions (conflict_id, new_passage_id, old_passage_id, decision, decided_by) VALUES ${values}`),
      );
    const newPassage = w.ds.passageIds[0];
    await expect(insert("manager", `('pc-c', '${newPassage}', '${BLUEWING}', 'coexist', 'staff')`)).rejects.toThrow(/row-level security/);
    await expect(insert("manager", `('pc-c', '${newPassage}', '${PUBLIC}', 'coexist', 'manager')`)).rejects.toThrow(/foreign key/);
    await expect(insert("manager", `('pc-c', '${newPassage}', '${BLUEWING}', 'delete', 'manager')`)).rejects.toThrow(/check constraint/);
    // 沒有 canReview
    await expect(insert("staff", `('pc-c', '${newPassage}', '${BLUEWING}', 'coexist', 'staff')`)).rejects.toThrow(/row-level security/);
    // 以 store 寫入時不顯示資料庫的訊息
    await expect(decideConflict(w.db, "manager", "pc-c", "delete" as ConflictDecision)).rejects.toMatchObject({ reason: "denied" });
    await expect(decideConflict(w.db, "manager", "pc-nope", "coexist")).rejects.toMatchObject({ reason: "denied" });
    // 寫入決定（INSERT … SELECT FROM kk.conflicts）與讀取兩張表時，policy 不會出現 infinite recursion（#51 決定 A）
    await expect(decideConflict(w.db, "manager", "pc-c", "coexist")).resolves.toBeUndefined();
    await w.db.close();
  });
});

describe("kk_app 的權限", { timeout: 30_000 }, () => {
  it("新資料表只有 SELECT、INSERT，沒有 UPDATE、DELETE", async () => {
    const w = await setup();
    const privileges = await w.db.withIdentity("manager", async (tx) =>
      (
        await tx.query<{ t: string; p: string; ok: boolean }>(
          `SELECT t, p, has_table_privilege('kk_app', 'kk.' || t, p) AS ok
             FROM unnest(ARRAY['conflicts', 'conflict_decisions']) t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p`,
        )
      ).rows,
    );
    for (const r of privileges) expect(r.ok, `${r.t} ${r.p}`).toBe(r.p === "SELECT" || r.p === "INSERT");
    for (const sql of ["UPDATE kk.conflict_decisions SET decision = 'not_conflict'", "DELETE FROM kk.conflicts", "UPDATE kk.conflicts SET summary = 'x'"]) {
      await expect(w.db.withIdentity("manager", (tx) => tx.exec(sql)), sql).rejects.toThrow(/permission denied/);
    }
    await w.db.close();
  });
});

describe("readConflicts", { timeout: 30_000 }, () => {
  it("每組附兩段的內容、文件標題、等級、專案、日期與決定", async () => {
    const w = await setup();
    const items = await readConflicts(w.db, "manager");
    const s1 = items.find((c) => c.id === "pc-s1")!;
    expect(s1).toMatchObject({
      documentId: w.ds.documentId,
      summary: "差異說明 pc-s1",
      decision: "coexist",
      newPassage: { id: w.ds.passageIds[0], documentId: w.ds.documentId, documentTitle: "青翼進度（虛構）", visibility: "internal", project: "bluewing", date: "2026-10-20", content: "青翼專案延到第三季。" },
      oldPassage: { id: BLUEWING, documentId: "bluewing-kickoff-zh", visibility: "internal", project: "bluewing" },
    });
    expect(items.find((c) => c.id === "pc-s2")!.decision).toBeNull();
    // 一般員工只看得到並存與取代（且兩段都看得到）
    expect((await readConflicts(w.db, "staff")).map((c) => `${c.id} ${c.decision}`).sort()).toEqual(["pc-p1 coexist", "pc-s1 coexist"]);
    await w.db.close();
  });
});
