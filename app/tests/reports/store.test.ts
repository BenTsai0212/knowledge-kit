// 回答錯誤回報的權限（ADR 0007 決定 7，回報者讀得到自己的回報：ADR 0009、#286）：以 oracle.ts 比對每個身分看得到的回報與處理、能寫入與能處理的回報，
// 並以「忽略身分的資料層」做反向驗證。另以「一般員工也能審核」的設定，測試送出的段落有一段看不到時看不到該回報。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import type { ClientConfig } from "../../src/client/types";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { ReviewError } from "../../src/extraction/store";
import { readMyReport, readReports, resolveReport, writeReport, type NewReport, type ReportCategory } from "../../src/reports/store";
import { datasetSample } from "../db/dataset-sample";
import { canResolveReport, canWriteReport, expectedReportVisible, expectedVisible, REPORT_KEY_SQL, type ReportSample } from "../db/oracle";

const IDENTITIES = ["guest", "staff", "manager", null, "nobody"];
const STAFF_REVIEWS: ClientConfig = {
  ...clientConfig,
  access: { ...clientConfig.access, roles: clientConfig.access.roles.map((r) => (r.id === "staff" ? { ...r, canReview: true } : r)) },
};

// 資料集的段落：公開、公開、青翼內部、機密、長堤內部
const PUBLIC = "employee-handbook-zh-01";
const PUBLIC2 = "employee-handbook-zh-02";
const BLUEWING = "bluewing-kickoff-zh-01";
const CONFIDENTIAL = "reorg-2026-zh-01";
const LONGPIER = "longpier-progress-zh-01";

// 實體：訪客看得到的、只有主管看得到的（從資料集算出，不寫死）
const entitiesOf = (id: string) => expectedVisible(clientConfig.access, datasetSample, id).entities;
const PUBLIC_ENTITY = entitiesOf("guest")[0];
const MANAGER_ONLY_ENTITY = entitiesOf("manager").find((e) => !entitiesOf("staff").includes(e))!;

const answer = (sent: string[], cited: string[], entities: string[] = []): NewReport["answer"] => ({ text: "回答內容（虛構）", sent, cited, entities });

// 寫入的回報：回報者、內容。key 只用於測試中指稱
const REPORTS: { key: string; by: string; report: NewReport }[] = [
  { key: "pub", by: "guest", report: { category: "wrong_fact", note: "日期不對", question: "上班時間？", answer: answer([PUBLIC, PUBLIC2], [PUBLIC], [PUBLIC_ENTITY]) } },
  { key: "refusal", by: "guest", report: { category: "should_answer", note: null, question: "停車位怎麼申請？", answer: null } },
  { key: "blue", by: "staff", report: { category: "wrong_citation", note: null, question: "青翼何時開始？", answer: answer([PUBLIC, BLUEWING], [BLUEWING]) } },
  // 沒有引用機密段落，但送出了：看不到機密段落的審核者看不到這個回報（#209 決定 5）
  { key: "conf", by: "manager", report: { category: "missing", note: null, question: "組織調整？", answer: answer([PUBLIC, CONFIDENTIAL], [PUBLIC], [MANAGER_ONLY_ENTITY]) } },
  { key: "long", by: "manager", report: { category: "other", note: "  ", question: "長堤進度？", answer: answer([LONGPIER], [LONGPIER]) } },
];

interface World {
  db: Database;
  reports: ReportSample;
  // key → 寫入後的 id
  ids: Record<string, string>;
}

async function setup(config: ClientConfig = clientConfig): Promise<World> {
  const db = await openDatabase(config, { seed: (pg) => seedDataset(pg, config, dataset) });
  const reports: ReportSample = { reports: [], resolutions: [] };
  const ids: Record<string, string> = {};
  for (const r of REPORTS) {
    ids[r.key] = await writeReport(db, r.by, r.report);
    reports.reports.push({ id: ids[r.key], by: r.by, sent: [...(r.report.answer?.sent ?? [])] });
  }
  return { db, reports, ids };
}

const queryReports = (db: Database, id: string | null) =>
  db.withIdentity(id, async (tx) => {
    const out: Record<string, string[]> = {};
    for (const [table, key] of Object.entries(REPORT_KEY_SQL)) {
      out[table] = (await tx.query<{ k: string }>(`SELECT ${key} AS k FROM kk.${table}`)).rows.map((r) => r.k).sort();
    }
    return out;
  });
const sorted = (v: Record<string, string[]>) => Object.fromEntries(Object.entries(v).map(([k, list]) => [k, [...list].sort()]));

describe("測試資料的前提", () => {
  it("段落的可見等級與專案、實體的可見範圍符合預期", () => {
    const level = (id: string) => datasetSample.passages.find((p) => p.id === id);
    expect(level(PUBLIC)).toMatchObject({ level: "public", project: null });
    expect(level(PUBLIC2)).toMatchObject({ level: "public", project: null });
    expect(level(BLUEWING)).toMatchObject({ level: "internal", project: "bluewing" });
    expect(level(CONFIDENTIAL)).toMatchObject({ level: "confidential" });
    expect(level(LONGPIER)).toMatchObject({ level: "internal", project: "longpier" });
    expect(PUBLIC_ENTITY).toBeDefined();
    expect(MANAGER_ONLY_ENTITY).toBeDefined();
  });
});

describe.each([
  ["參考設定（只有主管審核）", clientConfig],
  ["一般員工也能審核", STAFF_REVIEWS],
])("回報與處理的可見範圍：%s", { timeout: 30_000 }, (_name, config) => {
  it("每個身分看得到的列，正好等於 oracle（有 canReview 或是回報者，且送出的段落全部看得到）", async () => {
    const w = await setup(config);
    await resolveReport(w.db, "manager", w.ids.pub, "not_error");
    await resolveReport(w.db, "manager", w.ids.conf, "retracted");
    w.reports.resolutions.push(w.ids.pub, w.ids.conf);
    for (const id of IDENTITIES) {
      const expected = expectedReportVisible(config.access, datasetSample, w.reports, id);
      expect(await queryReports(w.db, id), String(id)).toEqual(sorted(expected));
      expect((await readReports(w.db, id)).map((r) => r.id).sort(), `readReports ${id}`).toEqual([...expected.answer_reports].sort());
    }
    // 防止以全部看不到而通過
    expect(expectedReportVisible(config.access, datasetSample, w.reports, "manager").answer_reports).toHaveLength(5);
    // 訪客沒有 canReview：只讀得到自己的兩個回報與其處理（#286）
    expect(expectedReportVisible(config.access, datasetSample, w.reports, "guest")).toEqual({
      answer_reports: [w.ids.pub, w.ids.refusal],
      answer_report_resolutions: [w.ids.pub],
    });
    await w.db.close();
  });

  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const w = await setup(config);
    const ignoring: Database = { withIdentity: (_id, fn) => w.db.withIdentity("manager", fn), close: w.db.close };
    for (const id of ["guest", "staff", null]) {
      expect(await queryReports(ignoring, id), String(id)).not.toEqual(sorted(expectedReportVisible(config.access, datasetSample, w.reports, id)));
    }
    await w.db.close();
  });
});

describe("能審核、但看不到部分段落的身分", { timeout: 30_000 }, () => {
  it("送出的段落有一段看不到就看不到該回報，即使沒有引用那一段；拒答的回報看得到", async () => {
    const w = await setup(STAFF_REVIEWS);
    expect((await queryReports(w.db, "staff")).answer_reports).toEqual([w.ids.pub, w.ids.refusal, w.ids.blue].sort());
    // 沒有 canReview 的回報者只讀得到自己寫的回報（#286），讀不到別人的
    const v = await setup();
    expect((await queryReports(v.db, "staff")).answer_reports).toEqual([v.ids.blue]);
    expect((await queryReports(v.db, "manager")).answer_reports).toEqual(Object.values(v.ids).sort());
    await w.db.close();
    await v.db.close();
  });
});

describe("寫入回報", { timeout: 30_000 }, () => {
  it("每個身分 × 送出的段落 × 提到的實體能否寫入，正好等於 oracle", async () => {
    const w = await setup();
    const cases = [
      { sent: [], entities: [] },
      { sent: [PUBLIC], entities: [PUBLIC_ENTITY] },
      { sent: [PUBLIC, BLUEWING], entities: [] },
      { sent: [PUBLIC, CONFIDENTIAL], entities: [] },
      { sent: [LONGPIER], entities: [] },
      { sent: [PUBLIC], entities: [MANAGER_ONLY_ENTITY] },
      { sent: ["no-such-passage"], entities: [] },
    ];
    let allowed = 0;
    for (const id of IDENTITIES) {
      for (const c of cases) {
        const report: NewReport = { category: "other", note: null, question: "問題", answer: c.sent.length === 0 ? null : answer(c.sent, [], c.entities) };
        const expected = canWriteReport(clientConfig.access, datasetSample, id, c);
        const result = writeReport(w.db, id, report);
        const label = `${id} ${c.sent.join(",")} ${c.entities.join(",")}`;
        if (expected) {
          allowed++;
          await expect(result, label).resolves.toMatch(/^ar-/);
        } else {
          await expect(result, label).rejects.toMatchObject({ reason: "denied" });
        }
      }
    }
    // 防止以全部拒絕而通過：訪客 2、一般員工 3、主管 6
    expect(allowed).toBe(11);
    await w.db.close();
  });

  it("違反內容規則的回報被拒絕：引用不在送出的段落中、拒答附段落、回答沒有段落、類別、長度", async () => {
    const w = await setup();
    const write = (report: Partial<NewReport>) =>
      writeReport(w.db, "manager", { category: "wrong_fact", note: null, question: "問題", answer: answer([PUBLIC], [PUBLIC]), ...report });
    await expect(write({ answer: answer([PUBLIC], [PUBLIC2]) })).rejects.toMatchObject({ reason: "denied" });
    await expect(write({ answer: answer([], []) })).rejects.toMatchObject({ reason: "denied" });
    await expect(write({ category: "spam" as ReportCategory })).rejects.toMatchObject({ reason: "denied" });
    await expect(write({ question: "" })).rejects.toMatchObject({ reason: "denied" });
    await expect(write({ question: "長".repeat(501) })).rejects.toMatchObject({ reason: "denied" });
    await expect(write({ note: "長".repeat(1001) })).rejects.toMatchObject({ reason: "denied" });
    await expect(write({ answer: { ...answer([PUBLIC], [PUBLIC])!, text: "" } })).rejects.toMatchObject({ reason: "denied" });
    // 直接寫入：拒答附段落、回報者寫成別人、時間不是現在
    const insert = (identity: string, values: string) =>
      w.db.withIdentity(identity, (tx) =>
        tx.exec(`INSERT INTO kk.answer_reports (id, reported_by, reported_at, category, question, answer, sent_passage_ids) VALUES ${values}`),
      );
    await expect(insert("manager", `('ar-x1', 'manager', now(), 'other', 'q', NULL, ARRAY['${PUBLIC}'])`)).rejects.toThrow(/check constraint/);
    await expect(insert("staff", `('ar-x2', 'manager', now(), 'other', 'q', 'a', ARRAY['${PUBLIC}'])`)).rejects.toThrow(/row-level security/);
    await expect(insert("staff", `('ar-x3', 'staff', now() - interval '1 day', 'other', 'q', 'a', ARRAY['${PUBLIC}'])`)).rejects.toThrow(/row-level security/);
    await expect(insert("staff", `('x-4', 'staff', now(), 'other', 'q', 'a', ARRAY['${PUBLIC}'])`)).rejects.toThrow(/check constraint/);
    expect((await queryReports(w.db, "manager")).answer_reports).toHaveLength(REPORTS.length);
    await w.db.close();
  });
});

describe("處理", { timeout: 30_000 }, () => {
  it.each([
    ["參考設定（只有主管審核）", clientConfig],
    ["一般員工也能審核", STAFF_REVIEWS],
  ])("每個身分 × 每個回報能否處理，正好等於 oracle：%s", async (_name, config) => {
    const w = await setup(config);
    let allowed = 0;
    for (const id of IDENTITIES) {
      for (const r of REPORTS) {
        const reportId = w.ids[r.key];
        const expected = canResolveReport(config.access, datasetSample, w.reports, id, reportId);
        // 失敗的嘗試不留下紀錄；成功之後同一個回報不能再處理
        const result = resolveReport(w.db, id, reportId, "not_error");
        if (expected) {
          allowed++;
          await expect(result, `${id} ${r.key}`).resolves.toBeUndefined();
          w.reports.resolutions.push(reportId);
        } else {
          await expect(result, `${id} ${r.key}`).rejects.toBeInstanceOf(ReviewError);
        }
      }
    }
    // 每個回報由第一個看得到它的審核者處理一次
    expect(allowed).toBe(REPORTS.length);
    await w.db.close();
  });

  it("已處理的回報不能再處理；偽造的處理被拒絕：處理者寫成別人、沒有 canReview、看不到的回報、不存在的回報", async () => {
    const w = await setup(STAFF_REVIEWS);
    await resolveReport(w.db, "staff", w.ids.blue, "retracted");
    await expect(resolveReport(w.db, "manager", w.ids.blue, "not_error")).rejects.toMatchObject({ reason: "conflict" });
    await expect(resolveReport(w.db, "staff", w.ids.conf, "not_error")).rejects.toMatchObject({ reason: "denied" });
    await expect(resolveReport(w.db, "manager", "ar-nope", "not_error")).rejects.toMatchObject({ reason: "denied" });
    await expect(resolveReport(w.db, "manager", w.ids.pub, "delete" as "not_error")).rejects.toMatchObject({ reason: "denied" });
    await expect(resolveReport(w.db, "guest", w.ids.pub, "not_error")).rejects.toMatchObject({ reason: "denied" });
    const insert = (identity: string, values: string) =>
      w.db.withIdentity(identity, (tx) => tx.exec(`INSERT INTO kk.answer_report_resolutions (report_id, resolution, resolved_by, resolved_at) VALUES ${values}`));
    await expect(insert("manager", `('${w.ids.pub}', 'not_error', 'staff', now())`)).rejects.toThrow(/row-level security/);
    await expect(insert("manager", `('${w.ids.pub}', 'not_error', 'manager', now() - interval '1 day')`)).rejects.toThrow(/row-level security/);
    expect((await queryReports(w.db, "manager")).answer_report_resolutions).toEqual([w.ids.blue]);
    await w.db.close();
  });
});

describe("kk_app 的權限", { timeout: 30_000 }, () => {
  it("新資料表只有 SELECT、INSERT，沒有 UPDATE、DELETE", async () => {
    const w = await setup();
    await resolveReport(w.db, "manager", w.ids.pub, "not_error");
    const privileges = await w.db.withIdentity("manager", async (tx) =>
      (
        await tx.query<{ t: string; p: string; ok: boolean }>(
          `SELECT t, p, has_table_privilege('kk_app', 'kk.' || t, p) AS ok
             FROM unnest(ARRAY['answer_reports', 'answer_report_resolutions']) t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p`,
        )
      ).rows,
    );
    for (const r of privileges) expect(r.ok, `${r.t} ${r.p}`).toBe(r.p === "SELECT" || r.p === "INSERT");
    for (const sql of [
      "UPDATE kk.answer_reports SET answer = 'x'",
      "DELETE FROM kk.answer_reports",
      "UPDATE kk.answer_report_resolutions SET resolution = 'retracted'",
      "DELETE FROM kk.answer_report_resolutions",
    ]) {
      await expect(w.db.withIdentity("manager", (tx) => tx.exec(sql)), sql).rejects.toThrow(/permission denied/);
    }
    await w.db.close();
  });
});

describe("readReports", { timeout: 30_000 }, () => {
  it("每個回報附問題、回答、段落、實體與處理；說明空白時為 null；提到的實體只列出讀者看得到的", async () => {
    const w = await setup(STAFF_REVIEWS);
    await resolveReport(w.db, "manager", w.ids.pub, "not_error");
    const reports = await readReports(w.db, "manager");
    expect(reports.find((r) => r.id === w.ids.pub)).toMatchObject({
      reportedBy: "guest",
      category: "wrong_fact",
      note: "日期不對",
      question: "上班時間？",
      answer: "回答內容（虛構）",
      sentPassageIds: [PUBLIC, PUBLIC2],
      citedPassageIds: [PUBLIC],
      entityIds: [PUBLIC_ENTITY],
      resolution: "not_error",
    });
    expect(reports.find((r) => r.id === w.ids.pub)!.reportedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(reports.find((r) => r.id === w.ids.refusal)).toMatchObject({ answer: null, sentPassageIds: [], citedPassageIds: [], entityIds: [], resolution: null });
    expect(reports.find((r) => r.id === w.ids.long)!.note).toBeNull();
    expect(reports.find((r) => r.id === w.ids.conf)!.entityIds).toEqual([MANAGER_ONLY_ENTITY]);
    await w.db.close();
  });

  it("送出的段落都看得到、但提到的實體看不到時，回報看得到、實體不列出", async () => {
    const w = await setup(STAFF_REVIEWS);
    const id = await writeReport(w.db, "manager", { category: "other", note: null, question: "q", answer: answer([PUBLIC], [], [PUBLIC_ENTITY, MANAGER_ONLY_ENTITY]) });
    expect((await readReports(w.db, "manager")).find((r) => r.id === id)!.entityIds).toEqual([PUBLIC_ENTITY, MANAGER_ONLY_ENTITY]);
    expect((await readReports(w.db, "staff")).find((r) => r.id === id)!.entityIds).toEqual([PUBLIC_ENTITY]);
    await w.db.close();
  });
});

// 回報結果回到回報的人（#286）：沒有 canReview 的身分讀得到自己的回報與處理（含說明），讀不到別人的
describe("回報者讀得到自己的回報與處理", { timeout: 30_000 }, () => {
  it("一般員工讀得到自己的回報與處理（含說明、處理者、時間），讀不到別人的；仍不能處理", async () => {
    const w = await setup();
    await resolveReport(w.db, "manager", w.ids.blue, "not_error", "  引用的段落是正確的（虛構）  ");
    await resolveReport(w.db, "manager", w.ids.pub, "retracted", "已撤回");
    const staff = await queryReports(w.db, "staff");
    expect(staff).toEqual({ answer_reports: [w.ids.blue], answer_report_resolutions: [w.ids.blue] });
    const mine = await readMyReport(w.db, "staff", w.ids.blue);
    expect(mine).toMatchObject({
      id: w.ids.blue,
      reportedBy: "staff",
      resolution: "not_error",
      resolvedBy: "manager",
      resolutionNote: "引用的段落是正確的（虛構）",
    });
    expect(mine!.resolvedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect((await readReports(w.db, "staff")).map((r) => r.id)).toEqual([w.ids.blue]);
    // 別人的回報：即使送出的段落自己全部看得到
    expect(await readMyReport(w.db, "staff", w.ids.pub)).toBeNull();
    expect(await readMyReport(w.db, "guest", w.ids.pub)).toMatchObject({ resolution: "retracted", resolutionNote: "已撤回" });
    expect(await readMyReport(w.db, "guest", w.ids.blue)).toBeNull();
    // 主管讀自己以外的回報不經 readMyReport；沒有身分讀不到
    expect(await readMyReport(w.db, "manager", w.ids.blue)).toBeNull();
    expect(await readMyReport(w.db, null, w.ids.blue)).toBeNull();
    // 讀得到之後仍不能處理
    await expect(resolveReport(w.db, "guest", w.ids.refusal, "not_error")).rejects.toMatchObject({ reason: "denied" });
    // 還沒處理的回報：處理的欄位都是 null
    expect(await readMyReport(w.db, "guest", w.ids.refusal)).toMatchObject({ resolution: null, resolvedAt: null, resolvedBy: null, resolutionNote: null });
    await w.db.close();
  });

  it("送出的段落之後有一段看不到時，回報者讀不到自己的回報與處理；審核者照常讀得到", async () => {
    // 一般員工回報後段落的可見等級被調低的情況：直接匯入一個送出了機密段落的一般員工回報與其處理（內容虛構）
    const db = await openDatabase(clientConfig, {
      seed: async (pg) => {
        await seedDataset(pg, clientConfig, dataset);
        await pg.exec(`
          INSERT INTO kk.answer_reports (id, reported_by, category, question, answer, sent_passage_ids, cited_passage_ids)
            VALUES ('ar-hidden', 'staff', 'other', '問題（虛構）', '回答（虛構）', ARRAY['${PUBLIC}', '${CONFIDENTIAL}'], ARRAY['${PUBLIC}']);
          INSERT INTO kk.answer_report_resolutions (report_id, resolution, resolved_by, note) VALUES ('ar-hidden', 'not_error', 'manager', '說明（虛構）');`);
      },
    });
    const sample: ReportSample = { reports: [{ id: "ar-hidden", by: "staff", sent: [PUBLIC, CONFIDENTIAL] }], resolutions: ["ar-hidden"] };
    for (const id of IDENTITIES) {
      expect(await queryReports(db, id), String(id)).toEqual(sorted(expectedReportVisible(clientConfig.access, datasetSample, sample, id)));
    }
    expect(await queryReports(db, "staff")).toEqual({ answer_reports: [], answer_report_resolutions: [] });
    expect(await readMyReport(db, "staff", "ar-hidden")).toBeNull();
    expect((await queryReports(db, "manager")).answer_report_resolutions).toEqual(["ar-hidden"]);
    await db.close();
  });
});

describe("給回報的人的說明", { timeout: 30_000 }, () => {
  it("1～500 字可寫入；空白送 null；超過 500 字被拒（store 與資料庫的 CHECK）；空字串被 CHECK 拒絕", async () => {
    const w = await setup();
    await resolveReport(w.db, "manager", w.ids.pub, "not_error", "長".repeat(500));
    await resolveReport(w.db, "manager", w.ids.refusal, "not_error", "   ");
    await expect(resolveReport(w.db, "manager", w.ids.blue, "not_error", "長".repeat(501))).rejects.toMatchObject({ reason: "denied" });
    const read = async (id: string) => (await readReports(w.db, "manager")).find((r) => r.id === id)!;
    expect((await read(w.ids.pub)).resolutionNote).toHaveLength(500);
    expect((await read(w.ids.refusal)).resolutionNote).toBeNull();
    expect((await read(w.ids.blue)).resolution).toBeNull();
    // 直接寫入，不經 store 的檢查
    const insert = (note: string) =>
      w.db.withIdentity("manager", (tx) =>
        tx.query("INSERT INTO kk.answer_report_resolutions (report_id, resolution, resolved_by, note) VALUES ($1, 'not_error', 'manager', $2)", [w.ids.blue, note]),
      );
    await expect(insert("")).rejects.toThrow(/check constraint/);
    await expect(insert("長".repeat(501))).rejects.toThrow(/check constraint/);
    expect((await read(w.ids.blue)).resolution).toBeNull();
    await w.db.close();
  });

  it("寫入後不能修改：沒有 UPDATE 權限；同一回報不能再處理一次來換說明", async () => {
    const w = await setup();
    await resolveReport(w.db, "manager", w.ids.pub, "not_error", "第一次的說明");
    await expect(w.db.withIdentity("manager", (tx) => tx.exec("UPDATE kk.answer_report_resolutions SET note = '改過'"))).rejects.toThrow(/permission denied/);
    await expect(resolveReport(w.db, "manager", w.ids.pub, "not_error", "第二次的說明")).rejects.toMatchObject({ reason: "conflict" });
    expect((await readReports(w.db, "manager")).find((r) => r.id === w.ids.pub)!.resolutionNote).toBe("第一次的說明");
    await w.db.close();
  });
});
