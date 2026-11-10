// 時間軸與原文面板的標示（#51，docs/conflicts.md「畫面」）：每個身分看到的標示，都以 oracle.ts 的 expectedMarks() 比對（滲漏 0、漏看 0）；
// 「取代不外流」：看不到新段落的身分沒有任何標示，也沒有新文件的標題。都以「忽略身分的資料層」做反向驗證。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import type { PassageMark } from "../../src/conflicts/marks";
import { decideConflict, writeConflicts, type ConflictDecision } from "../../src/conflicts/store";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { readTimeline } from "../../src/graph/timeline";
import { readSource } from "../../src/sources/source";
import { uploadDocument } from "../../src/upload/write";
import { datasetSample } from "../db/dataset-sample";
import { expectedMarks, expectedVisible, type ConflictSample } from "../db/oracle";
import type { Sample } from "../db/sample";

const access = clientConfig.access;
const IDENTITIES = ["guest", "staff", "manager", null, "nobody"];
const OPTIONS = { languages: clientConfig.client.languages };

// 資料集的公開段落：公司簡介、上班時間
const PROFILE = "employee-handbook-zh-01";
const HOURS = "employee-handbook-zh-02";

// 上傳的文件（內容虛構）：一般員工上傳的兩份公開文件，主管上傳的兩份機密文件
const UPLOADS = {
  dp: { by: "staff", title: "上班時間公告（虛構）", level: "public", date: "2026-10-10", passages: ["上班時間改為上午九點半到下午六點半。"] },
  dq: { by: "staff", title: "上班時間說明（虛構）", level: "public", date: "2026-10-12", passages: ["上班時間改為上午九點到下午五點半。"] },
  dm: {
    by: "manager",
    title: "組織調整草案（虛構）",
    level: "confidential",
    date: "2026-10-20",
    passages: ["上班時間改為上午十點到晚上七點。", "範例公司將擴編為約 200 人的辦公家具製造商。"],
  },
  dn: { by: "manager", title: "組織調整定案（虛構）", level: "confidential", date: "2026-10-25", passages: ["上班時間再改為上午十點半到晚上七點半。"] },
} as const;
type Doc = keyof typeof UPLOADS;

// 上班時間被三段取代（公開的兩段、機密的一段）；公司簡介被機密段落取代、與公開段落並存；
// 機密段落再被更新的機密段落取代；另有「不算說法不同」與未處理的組合（都不標示）
const PAIRS: { id: string; doc: Doc; newIndex: number; old: string | [Doc, number]; decision: ConflictDecision | null }[] = [
  { id: "pc-1", doc: "dp", newIndex: 0, old: HOURS, decision: "supersede" },
  { id: "pc-2", doc: "dq", newIndex: 0, old: HOURS, decision: "supersede" },
  { id: "pc-3", doc: "dm", newIndex: 0, old: HOURS, decision: "supersede" },
  { id: "pc-4", doc: "dm", newIndex: 1, old: PROFILE, decision: "supersede" },
  { id: "pc-5", doc: "dn", newIndex: 0, old: ["dm", 0], decision: "supersede" },
  { id: "pc-6", doc: "dq", newIndex: 0, old: PROFILE, decision: "coexist" },
  { id: "pc-7", doc: "dp", newIndex: 0, old: PROFILE, decision: "not_conflict" },
  { id: "pc-8", doc: "dn", newIndex: 0, old: PROFILE, decision: "coexist" },
  { id: "pc-9", doc: "dq", newIndex: 0, old: ["dp", 0], decision: null },
];

let db: Database;
let sample: Sample;
const conflicts: ConflictSample = { uploads: {}, conflicts: [], decisions: [] };
const dates: Record<string, string | null> = {};
const titles: Record<string, string> = {};
const ids = {} as Record<Doc, { documentId: string; passageIds: string[] }>;
const visible = (id: string | null) => expectedVisible(access, sample, id).passages;
const expected = (id: string | null, passages: readonly string[]) => {
  const map = expectedMarks(access, sample, conflicts, id, dates);
  return Object.fromEntries(passages.map((p) => [p, map.get(p) ?? []]));
};
const keys = (marks: PassageMark[]) => marks.map((m) => `${m.kind}|${m.passageId}`).sort();

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  sample = { ...datasetSample, docs: [...datasetSample.docs], passages: [...datasetSample.passages] };
  for (const d of Object.values(dataset.documents)) titles[d.id] = d.title;
  for (const [doc, u] of Object.entries(UPLOADS) as [Doc, (typeof UPLOADS)[Doc]][]) {
    const r = await uploadDocument(
      db,
      u.by,
      { title: u.title, language: "zh-TW", visibility: u.level, project: null, date: u.date, passages: [...u.passages] },
      OPTIONS,
    );
    ids[doc] = r;
    conflicts.uploads[r.documentId] = u.by;
    dates[r.documentId] = u.date;
    titles[r.documentId] = u.title;
    sample.docs.push({ id: r.documentId, level: u.level, project: null });
    sample.passages.push(...r.passageIds.map((id) => ({ id, doc: r.documentId, level: u.level, project: null })));
  }
  for (const p of PAIRS) {
    const pair = {
      id: p.id,
      newPassage: ids[p.doc].passageIds[p.newIndex],
      oldPassage: typeof p.old === "string" ? p.old : ids[p.old[0]].passageIds[p.old[1]],
      summary: `差異說明 ${p.id}`,
    };
    await writeConflicts(db, UPLOADS[p.doc].by, ids[p.doc].documentId, [pair]);
    if (p.decision !== null) await decideConflict(db, "manager", p.id, p.decision);
    conflicts.conflicts.push({ id: p.id, doc: ids[p.doc].documentId, newPassage: pair.newPassage, oldPassage: pair.oldPassage });
    if (p.decision !== null) conflicts.decisions.push({ conflict: p.id, decision: p.decision });
  }
});
afterAll(async () => {
  await db.close();
});

// 時間軸（zh-TW）上每段的標示
async function timelineMarks(database: Database, id: string | null) {
  const entries = await readTimeline(database, id, { language: "zh-TW" });
  return entries.flatMap((e) => e.passages.map((p) => [p.id, p.marks] as const));
}
// 原文面板：打開每一段看得到的段落，收集文件中每段的標示
async function sourceMarks(database: Database, id: string | null, passages: readonly string[]) {
  const out: (readonly [string, PassageMark[]])[] = [];
  for (const p of passages) {
    const source = await readSource(database, id, p);
    if (source !== null) out.push(...source.passages.map((q) => [q.id, q.marks] as const));
  }
  return out;
}
const asKeys = (rows: (readonly [string, PassageMark[]])[]) => Object.fromEntries(rows.map(([id, marks]) => [id, keys(marks)]));

describe("時間軸與原文的標示", () => {
  it("測試資料的前提：主管與一般員工看到的標示不同，未處理與「不算說法不同」不標示", () => {
    const manager = expectedMarks(access, sample, conflicts, "manager", dates);
    const staff = expectedMarks(access, sample, conflicts, "staff", dates);
    expect(manager.get(HOURS)).toEqual([`superseded_by|${ids.dm.passageIds[0]}`]);
    expect(staff.get(HOURS)).toEqual([`superseded_by|${ids.dq.passageIds[0]}`]);
    expect(staff.get(PROFILE)).toEqual([`conflict|${ids.dq.passageIds[0]}`]);
    expect(manager.get(ids.dp.passageIds[0])).toEqual([`supersedes|${HOURS}`]);
    expect(expectedMarks(access, sample, conflicts, null, dates).size).toBe(0);
  });

  it("每個身分：時間軸每段的標示與 oracle 相同（滲漏 0、漏看 0）", async () => {
    for (const id of IDENTITIES) {
      const rows = await timelineMarks(db, id);
      expect(asKeys(rows), String(id)).toEqual(expected(id, rows.map(([p]) => p)));
    }
  });

  it("每個身分：原文面板每段的標示與 oracle 相同", async () => {
    let opened = 0;
    for (const id of IDENTITIES) {
      const rows = await sourceMarks(db, id, [HOURS, PROFILE, ...Object.values(ids).flatMap((x) => x.passageIds)]);
      opened += rows.length;
      expect(asKeys(rows), String(id)).toEqual(expected(id, rows.map(([p]) => p)));
    }
    expect(opened).toBeGreaterThan(0);
  });

  it("標示附另一段所屬的文件 id 與標題", async () => {
    for (const id of ["staff", "manager"]) {
      for (const [, marks] of await timelineMarks(db, id)) {
        for (const m of marks) {
          expect(sample.passages.find((p) => p.id === m.passageId)?.doc, id).toBe(m.documentId);
          expect(m.documentTitle, id).toBe(titles[m.documentId]);
        }
      }
    }
  });

  it("取代不外流：主管以機密段落取代的公開段落，一般員工的時間軸與原文都沒有任何標示，也沒有機密文件的標題；主管則有", async () => {
    const secret: string[] = [UPLOADS.dm.title, UPLOADS.dn.title];
    for (const id of ["guest", "staff"]) {
      const rows = [...(await timelineMarks(db, id)), ...(await sourceMarks(db, id, visible(id)))];
      const all = rows.flatMap(([, marks]) => marks);
      expect(all.length, id).toBeGreaterThan(0);
      expect(all.filter((m) => secret.includes(m.documentTitle)), id).toEqual([]);
      // 公司簡介：只有與公開段落的並存，沒有「已由…取代」
      expect(keys(rows.find(([p]) => p === PROFILE)![1]), id).toEqual([`conflict|${ids.dq.passageIds[0]}`]);
    }
    const manager = await timelineMarks(db, "manager");
    expect(manager.find(([p]) => p === PROFILE)![1]).toContainEqual({
      kind: "superseded_by",
      passageId: ids.dm.passageIds[1],
      documentId: ids.dm.documentId,
      documentTitle: UPLOADS.dm.title,
    });
  });

  it("反向驗證：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    for (const id of ["guest", "staff"]) {
      const timeline = await timelineMarks(ignoring, id);
      const visibleOnly = timeline.filter(([p]) => visible(id).includes(p));
      expect(asKeys(visibleOnly), id).not.toEqual(expected(id, visibleOnly.map(([p]) => p)));
      const source = await sourceMarks(ignoring, id, [PROFILE]);
      expect(asKeys(source), id).not.toEqual(expected(id, source.map(([p]) => p)));
    }
  });
});
