// 人的理解的權限（ADR 0012 決定 5、6，#380 PR 3）：以 oracle.ts 比對每個身分看得到的理解與能寫入的組合，
// 並以「忽略身分的資料層」做反向驗證；另測試偽造的寫入、欄位的限制與 kk_app 沒有 UPDATE、DELETE。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import {
  MAX_CHOICE_CHARS,
  MAX_INTERPRETATION_NOTE_CHARS,
  OTHER_CHOICE,
  readInterpretations,
  writeInterpretation,
  type NewInterpretation,
} from "../../src/conflicts/interpretations";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { datasetSample } from "../db/dataset-sample";
import { canWriteInterpretation, expectedInterpretationVisible, INTERPRETATION_KEY_SQL, type InterpretationSample } from "../db/oracle";

const IDENTITIES = ["guest", "staff", "manager", null, "nobody"];
const access = clientConfig.access;

// 資料集的段落：公開、公開、青翼內部、機密、長堤內部
const PUBLIC = "employee-handbook-zh-01";
const PUBLIC2 = "employee-handbook-zh-02";
const BLUEWING = "bluewing-kickoff-zh-01";
const CONFIDENTIAL = "reorg-2026-zh-01";
const LONGPIER = "longpier-progress-zh-01";
const ALL = [PUBLIC, PUBLIC2, BLUEWING, CONFIDENTIAL, LONGPIER];

// 寫入的理解（內容虛構）：作者、兩段（順序不拘）、選擇。key 只用於測試中指稱
const SEED: { key: string; by: string; a: string; b: string; x?: Partial<NewInterpretation> }[] = [
  { key: "g-pp", by: "guest", a: PUBLIC, b: PUBLIC2 },
  // 同一組、反過來的順序、另一個作者
  { key: "s-pp", by: "staff", a: PUBLIC2, b: PUBLIC },
  { key: "s-bp", by: "staff", a: BLUEWING, b: PUBLIC },
  { key: "m-cp", by: "manager", a: CONFIDENTIAL, b: PUBLIC, x: { choice: OTHER_CHOICE, note: "兩份講的是不同年度" } },
  { key: "m-lb", by: "manager", a: LONGPIER, b: BLUEWING, x: { changedAfterChallenge: true } },
  { key: "m-pp", by: "manager", a: PUBLIC, b: PUBLIC2 },
];

interface World {
  db: Database;
  sample: InterpretationSample;
  // key → 寫入後的 id
  ids: Record<string, string>;
}

const input = (a: string, b: string, x: Partial<NewInterpretation> = {}): NewInterpretation => ({
  passages: [a, b],
  choice: "我覺得是後來改過",
  changedAfterChallenge: false,
  note: null,
  ...x,
});

async function setup(): Promise<World> {
  const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  const sample: InterpretationSample = { interpretations: [] };
  const ids: Record<string, string> = {};
  for (const s of SEED) {
    ids[s.key] = await writeInterpretation(db, s.by, input(s.a, s.b, s.x));
    sample.interpretations.push({ id: ids[s.key], by: s.by, a: s.a, b: s.b });
  }
  return { db, sample, ids };
}

const query = (db: Database, id: string | null) =>
  db.withIdentity(id, async (tx) => {
    const out: Record<string, string[]> = {};
    for (const [table, key] of Object.entries(INTERPRETATION_KEY_SQL)) {
      out[table] = (await tx.query<{ k: string }>(`SELECT ${key} AS k FROM kk.${table}`)).rows.map((r) => r.k).sort();
    }
    return out;
  });
const sorted = (v: Record<string, string[]>) => Object.fromEntries(Object.entries(v).map(([k, list]) => [k, [...list].sort()]));

describe("測試資料的前提", () => {
  it("段落的可見等級與專案符合預期", () => {
    const level = (id: string) => datasetSample.passages.find((p) => p.id === id);
    expect(level(PUBLIC)).toMatchObject({ level: "public", project: null });
    expect(level(PUBLIC2)).toMatchObject({ level: "public", project: null });
    expect(level(BLUEWING)).toMatchObject({ level: "internal", project: "bluewing" });
    expect(level(CONFIDENTIAL)).toMatchObject({ level: "confidential" });
    expect(level(LONGPIER)).toMatchObject({ level: "internal", project: "longpier" });
  });
});

describe("理解的可見範圍", { timeout: 30_000 }, () => {
  it("每個身分看得到的列，正好等於 oracle（兩段都看得到，不看作者）", async () => {
    const w = await setup();
    for (const id of IDENTITIES) {
      const expected = expectedInterpretationVisible(access, datasetSample, w.sample, id);
      expect(await query(w.db, id), String(id)).toEqual(sorted(expected));
      expect((await readInterpretations(w.db, id)).map((x) => x.id).sort(), `readInterpretations ${id}`).toEqual([...expected.interpretations].sort());
    }
    // 防止以全部看不到而通過；訪客看得到一般員工與主管對兩段公開段落的理解
    const visible = (id: string) => expectedInterpretationVisible(access, datasetSample, w.sample, id).interpretations;
    expect(visible("manager")).toHaveLength(SEED.length);
    expect(visible("guest").sort()).toEqual([w.ids["g-pp"], w.ids["s-pp"], w.ids["m-pp"]].sort());
    expect(visible("staff")).toHaveLength(4);
    await w.db.close();
  });

  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const w = await setup();
    const ignoring: Database = { withIdentity: (_id, fn) => w.db.withIdentity("manager", fn), close: w.db.close };
    for (const id of ["guest", "staff", null]) {
      expect(await query(ignoring, id), String(id)).not.toEqual(sorted(expectedInterpretationVisible(access, datasetSample, w.sample, id)));
    }
    await w.db.close();
  });
});

describe("寫入", { timeout: 30_000 }, () => {
  it("每個身分 × 每一組（含同一段）能否寫入，正好等於 oracle", async () => {
    const w = await setup();
    const pairs = ALL.flatMap((a, i) => ALL.slice(i).map((b) => ({ a, b })));
    let allowed = 0;
    for (const id of IDENTITIES) {
      for (const pair of pairs) {
        const expected = canWriteInterpretation(access, datasetSample, w.sample, id, pair);
        const result = writeInterpretation(w.db, id, input(pair.b, pair.a));
        const label = `${id} ${pair.a} ${pair.b}`;
        if (expected) {
          allowed++;
          w.sample.interpretations.push({ id: await result, by: id!, ...pair });
        } else {
          await expect(result, label).rejects.toMatchObject({ reason: expect.stringMatching(/^(denied|conflict)$/) });
        }
      }
    }
    // 防止以全部拒絕而通過：訪客 0（唯一一組已寫過）、一般員工 1（公開 2 × 青翼）、主管 7（10 組減去已寫過的 3 組）
    expect(allowed).toBe(8);
    // 寫入後，每個身分看得到的列仍等於 oracle
    for (const id of IDENTITIES) {
      expect(await query(w.db, id), String(id)).toEqual(sorted(expectedInterpretationVisible(access, datasetSample, w.sample, id)));
    }
    await w.db.close();
  });

  it("同一個身分對同一組只留一筆（順序不拘），是 conflict；看不到其中一段是 denied", async () => {
    const w = await setup();
    await expect(writeInterpretation(w.db, "staff", input(PUBLIC, BLUEWING))).rejects.toMatchObject({ reason: "conflict" });
    await expect(writeInterpretation(w.db, "staff", input(PUBLIC, CONFIDENTIAL))).rejects.toMatchObject({ reason: "denied" });
    await expect(writeInterpretation(w.db, "guest", input(PUBLIC, BLUEWING))).rejects.toMatchObject({ reason: "denied" });
    await expect(writeInterpretation(w.db, null, input(PUBLIC, PUBLIC2))).rejects.toMatchObject({ reason: "denied" });
    await w.db.close();
  });

  it("欄位的限制：同一段、選擇與說明的長度、說明只用於 other；空白說明視為沒有", async () => {
    const w = await setup();
    const write = (x: Partial<NewInterpretation>) => writeInterpretation(w.db, "manager", input(BLUEWING, CONFIDENTIAL, x));
    await expect(write({ passages: [PUBLIC, PUBLIC] })).rejects.toMatchObject({ reason: "denied" });
    await expect(write({ choice: "" })).rejects.toMatchObject({ reason: "denied" });
    await expect(write({ choice: "長".repeat(MAX_CHOICE_CHARS + 1) })).rejects.toMatchObject({ reason: "denied" });
    await expect(write({ note: "說明只用於 other" })).rejects.toMatchObject({ reason: "denied" });
    await expect(write({ choice: OTHER_CHOICE, note: "長".repeat(MAX_INTERPRETATION_NOTE_CHARS + 1) })).rejects.toMatchObject({ reason: "denied" });
    // 失敗的嘗試沒有留下紀錄
    expect(await readInterpretations(w.db, "manager", [BLUEWING, CONFIDENTIAL])).toEqual([]);
    await write({ choice: OTHER_CHOICE, note: "   " });
    expect(await readInterpretations(w.db, "manager", [CONFIDENTIAL, BLUEWING])).toMatchObject([{ choice: OTHER_CHOICE, note: null }]);
    await w.db.close();
  });

  it("偽造的寫入被拒絕：作者寫成別人、時間不是現在、兩段順序相反、不存在的段落", async () => {
    const w = await setup();
    const insert = (identity: string, values: string) =>
      w.db.withIdentity(identity, (tx) =>
        tx.exec(`INSERT INTO kk.interpretations (id, passage_a, passage_b, choice, created_by, created_at) VALUES ${values}`),
      );
    const [a, b] = [BLUEWING, CONFIDENTIAL].sort();
    await expect(insert("manager", `('in-f1', '${a}', '${b}', 'x', 'staff', now())`)).rejects.toThrow(/row-level security/);
    await expect(insert("manager", `('in-f2', '${a}', '${b}', 'x', 'manager', now() - interval '1 day')`)).rejects.toThrow(/row-level security/);
    await expect(insert("manager", `('in-f3', '${b}', '${a}', 'x', 'manager', now())`)).rejects.toThrow(/check constraint/);
    await expect(insert("manager", `('x-f4', '${a}', '${b}', 'x', 'manager', now())`)).rejects.toThrow(/check constraint/);
    await expect(insert("manager", `('in-f5', '${a}', 'no-such-passage', 'x', 'manager', now())`)).rejects.toThrow(/row-level security|foreign key/);
    // 看不到其中一段：一般員工看不到機密段落
    await expect(insert("staff", `('in-f6', '${a}', '${b}', 'x', 'staff', now())`)).rejects.toThrow(/row-level security/);
    await expect(insert("manager", `('in-ok', '${a}', '${b}', 'x', 'manager', now())`)).resolves.toBeDefined();
    await w.db.close();
  });
});

describe("readInterpretations", { timeout: 30_000 }, () => {
  it("指定兩段時只讀那一組（順序不拘），附作者、時間與 mine；舊的在前", async () => {
    const w = await setup();
    const items = await readInterpretations(w.db, "staff", [PUBLIC2, PUBLIC]);
    expect(items.map((x) => x.id)).toEqual([w.ids["g-pp"], w.ids["s-pp"], w.ids["m-pp"]]);
    expect(items.map((x) => `${x.createdBy} ${x.mine}`)).toEqual(["guest false", "staff true", "manager false"]);
    const [a, b] = [PUBLIC, PUBLIC2].sort();
    expect(items[1]).toMatchObject({ passageA: a, passageB: b, choice: "我覺得是後來改過", changedAfterChallenge: false, note: null });
    expect(items[1].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const manager = await readInterpretations(w.db, "manager");
    expect(manager.find((x) => x.id === w.ids["m-cp"])).toMatchObject({ choice: OTHER_CHOICE, note: "兩份講的是不同年度", mine: true });
    expect(manager.find((x) => x.id === w.ids["m-lb"])).toMatchObject({ changedAfterChallenge: true });
    // 看不到其中一段的組：讀不到
    expect(await readInterpretations(w.db, "staff", [CONFIDENTIAL, PUBLIC])).toEqual([]);
    await w.db.close();
  });
});

describe("kk_app 的權限", { timeout: 30_000 }, () => {
  it("新資料表只有 SELECT、INSERT，沒有 UPDATE、DELETE", async () => {
    const w = await setup();
    const privileges = await w.db.withIdentity("manager", async (tx) =>
      (
        await tx.query<{ p: string; ok: boolean }>(
          `SELECT p, has_table_privilege('kk_app', 'kk.interpretations', p) AS ok
             FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p`,
        )
      ).rows,
    );
    for (const r of privileges) expect(r.ok, r.p).toBe(r.p === "SELECT" || r.p === "INSERT");
    for (const sql of ["UPDATE kk.interpretations SET choice = 'x'", "DELETE FROM kk.interpretations"]) {
      await expect(w.db.withIdentity("manager", (tx) => tx.exec(sql)), sql).rejects.toThrow(/permission denied/);
    }
    await w.db.close();
  });
});
