// 來源確認的權限（ADR 0013，#417 PR 2）：以 oracle.ts 比對每個身分看得到的確認紀錄、能否寫入與目前已確認的段落，
// 並以「忽略身分的資料層」做反向驗證；另測試偽造的寫入、同一時間的先後、kk_app 沒有 UPDATE、DELETE，以及失效判斷只依看得到的說法不同。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { decideConflict, writeConflicts } from "../../src/conflicts/store";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { readConfirmations, writeConfirmation, type ConfirmationAction } from "../../src/sources/confirmations";
import { uploadDocument } from "../../src/upload/write";
import { datasetSample } from "../db/dataset-sample";
import { canWriteConfirmation, CONFIRMATION_KEY_SQL, expectedConfirmationVisible, expectedConfirmed, type ConfirmationSample } from "../db/oracle";

const IDENTITIES = ["guest", "staff", "manager", null, "nobody"];
const access = clientConfig.access;

// 資料集的段落：公開、公開、青翼內部、機密、長堤內部（等級見 interpretations.test.ts 的前提）
const PUBLIC = "employee-handbook-zh-01";
const PUBLIC2 = "employee-handbook-zh-02";
const BLUEWING = "bluewing-kickoff-zh-01";
const CONFIDENTIAL = "reorg-2026-zh-01";
const LONGPIER = "longpier-progress-zh-01";
const ALL = [PUBLIC, PUBLIC2, BLUEWING, CONFIDENTIAL, LONGPIER];

// 主管的紀錄：確認五段，第二段之後撤銷，青翼段落撤銷後再確認
const SEED: { passage: string; action: ConfirmationAction }[] = [
  ...ALL.map((passage) => ({ passage, action: "confirm" as const })),
  { passage: PUBLIC2, action: "revoke" },
  { passage: BLUEWING, action: "revoke" },
  { passage: BLUEWING, action: "confirm" },
];

async function setup(): Promise<{ db: Database; sample: ConfirmationSample }> {
  const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  const sample: ConfirmationSample = { confirmations: [] };
  for (const s of SEED) sample.confirmations.push({ id: await writeConfirmation(db, "manager", s.passage, s.action), by: "manager", ...s });
  return { db, sample };
}

const query = (db: Database, id: string | null) =>
  db.withIdentity(id, async (tx) => {
    const out: Record<string, string[]> = {};
    for (const [table, key] of Object.entries(CONFIRMATION_KEY_SQL)) {
      out[table] = (await tx.query<{ k: string }>(`SELECT ${key} AS k FROM kk.${table}`)).rows.map((r) => r.k).sort();
    }
    return out;
  });
const sorted = (v: Record<string, string[]>) => Object.fromEntries(Object.entries(v).map(([k, list]) => [k, [...list].sort()]));
const confirmedBy = async (db: Database, id: string | null) => Object.fromEntries([...(await readConfirmations(db, id))].map(([p, c]) => [p, c.confirmedBy]));

describe("確認紀錄的可見範圍", { timeout: 30_000 }, () => {
  it("每個身分看得到的紀錄與已確認的段落，正好等於 oracle（那一段看得到），而且不同身分的結果不同", async () => {
    const w = await setup();
    for (const id of IDENTITIES) {
      expect(await query(w.db, id), String(id)).toEqual(sorted(expectedConfirmationVisible(access, datasetSample, w.sample, id)));
      expect(await confirmedBy(w.db, id), `readConfirmations ${id}`).toEqual(Object.fromEntries(expectedConfirmed(access, datasetSample, w.sample, id)));
    }
    // 防止以全部看不到而通過：主管看得到 8 筆、已確認 4 段；一般員工看不到機密與長堤；訪客只看得到公開的兩段
    const count = (id: string) => expectedConfirmationVisible(access, datasetSample, w.sample, id).passage_confirmations.length;
    expect([count("guest"), count("staff"), count("manager")]).toEqual([3, 6, 8]);
    expect([...expectedConfirmed(access, datasetSample, w.sample, "manager").keys()].sort()).toEqual([PUBLIC, BLUEWING, CONFIDENTIAL, LONGPIER].sort());
    expect([...expectedConfirmed(access, datasetSample, w.sample, "staff").keys()].sort()).toEqual([PUBLIC, BLUEWING].sort());
    expect([...expectedConfirmed(access, datasetSample, w.sample, "guest").keys()]).toEqual([PUBLIC]);
    await w.db.close();
  });

  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const w = await setup();
    const ignoring: Database = { withIdentity: (_id, fn) => w.db.withIdentity("manager", fn), close: w.db.close };
    for (const id of ["guest", "staff", null]) {
      expect(await query(ignoring, id), String(id)).not.toEqual(sorted(expectedConfirmationVisible(access, datasetSample, w.sample, id)));
      expect(await confirmedBy(ignoring, id), String(id)).not.toEqual(Object.fromEntries(expectedConfirmed(access, datasetSample, w.sample, id)));
    }
    await w.db.close();
  });
});

describe("寫入", { timeout: 30_000 }, () => {
  it("每個身分 × 每一段 × 確認與撤銷能否寫入，正好等於 oracle", async () => {
    const w = await setup();
    let allowed = 0;
    for (const id of IDENTITIES) {
      for (const passage of [...ALL, "no-such-passage"]) {
        for (const action of ["confirm", "revoke"] as const) {
          const result = writeConfirmation(w.db, id, passage, action);
          if (canWriteConfirmation(access, datasetSample, id, passage)) {
            allowed++;
            w.sample.confirmations.push({ id: await result, by: id!, passage, action });
          } else {
            await expect(result, `${id} ${passage} ${action}`).rejects.toMatchObject({ reason: "denied" });
          }
        }
      }
    }
    // 防止以全部拒絕而通過：只有主管（canReview）能寫入，5 段 × 2；重複確認、沒確認就撤銷都不擋
    expect(allowed).toBe(10);
    for (const id of IDENTITIES) {
      expect(await query(w.db, id), String(id)).toEqual(sorted(expectedConfirmationVisible(access, datasetSample, w.sample, id)));
      expect(await confirmedBy(w.db, id), String(id)).toEqual({});
    }
    await w.db.close();
  });

  it("偽造的寫入被拒絕：作者寫成別人、時間不是現在、id 與 action 的格式、沒有 canReview、不存在的段落", async () => {
    const w = await setup();
    const insert = (identity: string, values: string) =>
      w.db.withIdentity(identity, (tx) => tx.exec(`INSERT INTO kk.passage_confirmations (id, passage_id, action, created_by, created_at) VALUES ${values}`));
    await expect(insert("manager", `('cf-f1', '${PUBLIC}', 'confirm', 'staff', now())`)).rejects.toThrow(/row-level security/);
    await expect(insert("manager", `('cf-f2', '${PUBLIC}', 'confirm', 'manager', now() + interval '1 day')`)).rejects.toThrow(/row-level security/);
    await expect(insert("manager", `('x-f3', '${PUBLIC}', 'confirm', 'manager', now())`)).rejects.toThrow(/check constraint/);
    await expect(insert("manager", `('cf-f4', '${PUBLIC}', 'verify', 'manager', now())`)).rejects.toThrow(/check constraint/);
    await expect(insert("staff", `('cf-f5', '${PUBLIC}', 'confirm', 'staff', now())`)).rejects.toThrow(/row-level security/);
    await expect(insert("manager", `('cf-f6', 'no-such-passage', 'confirm', 'manager', now())`)).rejects.toThrow(/row-level security|foreign key/);
    await expect(insert("manager", `('cf-ok', '${PUBLIC2}', 'confirm', 'manager', now())`)).resolves.toBeDefined();
    await w.db.close();
  });

  it("同一時間（同一個交易）以 seq 決定先後", async () => {
    const w = await setup();
    const insert = (rows: string) =>
      w.db.withIdentity("manager", (tx) => tx.exec(`INSERT INTO kk.passage_confirmations (id, passage_id, action, created_by) VALUES ${rows}`));
    await insert(`('cf-s1', '${PUBLIC2}', 'confirm', 'manager'), ('cf-s2', '${PUBLIC2}', 'revoke', 'manager'), ('cf-s3', '${PUBLIC2}', 'confirm', 'manager')`);
    await insert(`('cf-s4', '${LONGPIER}', 'revoke', 'manager'), ('cf-s5', '${LONGPIER}', 'confirm', 'manager'), ('cf-s6', '${LONGPIER}', 'revoke', 'manager')`);
    const now = await readConfirmations(w.db, "manager");
    expect([now.has(PUBLIC2), now.has(LONGPIER)]).toEqual([true, false]);
    await w.db.close();
  });
});

describe("失效判斷：只依目前身分看得到的說法不同", { timeout: 30_000 }, () => {
  it("尚未處理只有主管看到失效；並存兩端失效；以新的為準只有舊的一段失效", async () => {
    const w = await setup();
    // 一般員工上傳的公開文件（內容虛構），兩段分別與公開的兩段說法不同
    const up = await uploadDocument(
      w.db,
      "staff",
      { title: "公司簡介更新（虛構）", language: "zh-TW", visibility: "public", project: null, date: "2026-10-10", passages: ["範例公司改為約 80 人。", "上班時間改為上午十點。"] },
      { languages: clientConfig.client.languages },
    );
    const [n1, n2] = up.passageIds;
    await writeConflicts(w.db, "staff", up.documentId, [
      { id: "pc-c1", newPassage: n1, oldPassage: PUBLIC, summary: "人數不同" },
      { id: "pc-c2", newPassage: n2, oldPassage: PUBLIC2, summary: "時間不同" },
    ]);
    for (const p of [PUBLIC2, n1, n2]) await writeConfirmation(w.db, "manager", p, "confirm");
    const status = async (id: string) => Object.fromEntries([...(await readConfirmations(w.db, id))].map(([p, c]) => [p, c.status]));

    // 尚未處理：只有主管看得到這兩組
    expect(await status("manager")).toMatchObject({
      [PUBLIC]: { kind: "disputed", passageId: n1 },
      [n1]: { kind: "disputed", passageId: PUBLIC },
      [PUBLIC2]: { kind: "disputed", passageId: n2 },
      [n2]: { kind: "disputed", passageId: PUBLIC2 },
    });
    for (const id of ["staff", "guest"]) {
      const s = await status(id);
      for (const p of [PUBLIC, PUBLIC2, n1, n2]) expect(s[p], `${id} ${p}`).toEqual({ kind: "valid" });
    }

    await decideConflict(w.db, "manager", "pc-c1", "coexist");
    await decideConflict(w.db, "manager", "pc-c2", "supersede");
    for (const id of ["manager", "staff", "guest"]) {
      expect(await status(id), id).toMatchObject({
        [PUBLIC]: { kind: "disputed", passageId: n1 },
        [n1]: { kind: "disputed", passageId: PUBLIC },
        [PUBLIC2]: { kind: "superseded", passageId: n2 },
        [n2]: { kind: "valid" },
      });
    }
    // 看不到任何確認的痕跡
    for (const id of [null, "nobody"]) expect((await readConfirmations(w.db, id)).size, String(id)).toBe(0);
    await w.db.close();
  });
});

describe("kk_app 的權限", { timeout: 30_000 }, () => {
  it("新資料表只有 SELECT、INSERT，沒有 UPDATE、DELETE", async () => {
    const w = await setup();
    const privileges = await w.db.withIdentity("manager", async (tx) =>
      (
        await tx.query<{ p: string; ok: boolean }>(
          `SELECT p, has_table_privilege('kk_app', 'kk.passage_confirmations', p) AS ok
             FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p`,
        )
      ).rows,
    );
    for (const r of privileges) expect(r.ok, r.p).toBe(r.p === "SELECT" || r.p === "INSERT");
    for (const sql of ["UPDATE kk.passage_confirmations SET action = 'revoke'", "DELETE FROM kk.passage_confirmations"]) {
      await expect(w.db.withIdentity("manager", (tx) => tx.exec(sql)), sql).rejects.toThrow(/permission denied/);
    }
    await w.db.close();
  });
});
