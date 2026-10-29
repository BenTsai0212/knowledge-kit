// 問答的「取代」（#51，docs/qa.md「新說法取代舊說法」）：每個身分檢索到的 supersededBy、送出的 superseded-by，
// 都以 oracle.ts 的 expectedSupersede() 比對；「取代不外流」：看不到新段落的身分沒有任何標示，也沒有新文件的標題與內容。
// 都以「忽略身分的資料層」做反向驗證。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { decideConflict, writeConflicts, type ConflictDecision } from "../../src/conflicts/store";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { ask, type QaContext } from "../../src/qa/answer";
import { escapeText } from "../../src/qa/prompt";
import { fakeTransport } from "../../src/qa/testing";
import { openRetriever } from "../../src/retrieval/retrieve";
import { uploadDocument } from "../../src/upload/write";
import { datasetSample } from "../db/dataset-sample";
import { expectedSupersede, expectedVisible, type ConflictSample } from "../db/oracle";
import type { Sample } from "../db/sample";

const access = clientConfig.access;
const IDENTITIES = ["guest", "staff", "manager", null, "nobody"];
const OPTIONS = { languages: clientConfig.client.languages };

// 資料集的公開段落：公司簡介、上班時間
const PROFILE = "employee-handbook-zh-01";
const HOURS = "employee-handbook-zh-02";

// 上傳的文件（內容虛構）：一般員工上傳的兩份公開文件（同一天），主管上傳的兩份機密文件
const UPLOADS = {
  dp: { by: "staff", title: "上班時間公告（虛構）", level: "public", date: "2026-10-10", passages: ["上班時間改為上午九點半到下午六點半。"] },
  dq: { by: "staff", title: "上班時間說明（虛構）", level: "public", date: "2026-10-10", passages: ["上班時間改為上午九點到下午五點半。"] },
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

// 偵測結果與主管的決定：上班時間被三段取代（兩段公開的同一天、一段機密的較新），
// 公司簡介只被機密段落取代，機密段落再被更新的機密段落取代（A→B→C 的鏈）
const PAIRS: { id: string; doc: Doc; newIndex: number; old: string | [Doc, number]; decision: ConflictDecision }[] = [
  { id: "pc-1", doc: "dp", newIndex: 0, old: HOURS, decision: "supersede" },
  { id: "pc-2", doc: "dq", newIndex: 0, old: HOURS, decision: "supersede" },
  { id: "pc-3", doc: "dm", newIndex: 0, old: HOURS, decision: "supersede" },
  { id: "pc-4", doc: "dm", newIndex: 1, old: PROFILE, decision: "supersede" },
  { id: "pc-5", doc: "dn", newIndex: 0, old: ["dm", 0], decision: "supersede" },
  { id: "pc-6", doc: "dq", newIndex: 0, old: PROFILE, decision: "coexist" },
  { id: "pc-7", doc: "dp", newIndex: 0, old: PROFILE, decision: "not_conflict" },
];

let db: Database;
let sample: Sample;
const conflicts: ConflictSample = { uploads: {}, conflicts: [], decisions: [] };
const dates: Record<string, string | null> = {};
const ids = {} as Record<Doc, { documentId: string; passageIds: string[] }>;
const textOf = (id: string) => Object.values(dataset.documents).flatMap((d) => d.passages).find((p) => p.id === id)!.text;
const visible = (id: string | null) => new Set(expectedVisible(access, sample, id).passages);
const supersede = (id: string | null) => expectedSupersede(access, sample, conflicts, id, dates);

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  sample = { ...datasetSample, docs: [...datasetSample.docs], passages: [...datasetSample.passages] };
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
    await decideConflict(db, "manager", p.id, p.decision);
    conflicts.conflicts.push({ id: p.id, doc: ids[p.doc].documentId, newPassage: pair.newPassage, oldPassage: pair.oldPassage });
    conflicts.decisions.push({ conflict: p.id, decision: p.decision });
  }
});
afterAll(async () => {
  await db.close();
});

// 不限名次與門檻，取出看得到的所有段落：段落 id → [取代者, 取代者的取代者]
async function retrievedSupersede(database: Database, id: string | null) {
  const passages = await openRetriever(database, clientConfig.client.retrieval).retrieve(id, "上班時間", { topK: 10_000, minScore: 0 });
  return new Map(passages.map((p) => [p.id, [p.supersededBy?.id ?? null, p.supersededBy?.supersededBy ?? null]]));
}
async function expectedRetrieved(id: string | null) {
  const map = supersede(id);
  return new Map([...visible(id)].map((p) => [p, [map.get(p) ?? null, map.has(p) ? (map.get(map.get(p)!) ?? null) : null]]));
}

describe("檢索的 supersededBy", () => {
  it("測試資料的前提：主管看得到 A→B→C 的鏈；上班時間在一般員工與主管看到的取代者不同", () => {
    const [m0, m1] = ids.dm.passageIds;
    expect(supersede("manager").get(HOURS)).toBe(m0);
    expect(supersede("manager").get(m0)).toBe(ids.dn.passageIds[0]);
    expect(supersede("manager").get(PROFILE)).toBe(m1);
    // 同一天的兩段公開段落取 id 較小的
    expect(supersede("staff").get(HOURS)).toBe([ids.dp.passageIds[0], ids.dq.passageIds[0]].sort()[0]);
    expect(supersede("staff").has(PROFILE)).toBe(false);
    expect(supersede("guest")).toEqual(supersede("staff"));
    expect(supersede(null).size).toBe(0);
  });

  it("每個身分的每一段：取代者與取代者的取代者都與 oracle 相同（滲漏 0、漏看 0）", async () => {
    for (const id of IDENTITIES) expect(await retrievedSupersede(db, id), String(id)).toEqual(await expectedRetrieved(id));
  });

  it("反向驗證：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    for (const id of ["guest", "staff"]) expect(await retrievedSupersede(ignoring, id), id).not.toEqual(await expectedRetrieved(id));
  });
});

describe("問答的 superseded-by 與取代不外流", () => {
  const confidential = (["dm", "dn"] as const).flatMap((d) => [`title="${escapeText(UPLOADS[d].title)}"`, ...UPLOADS[d].passages.map(escapeText)]);
  const QUERIES = [textOf(HOURS), textOf(PROFILE), ...Object.values(UPLOADS).flatMap((u) => u.passages)];
  const context = (database: Database) => {
    const transport = fakeTransport();
    const ctx: QaContext = {
      retriever: openRetriever(database, clientConfig.client.retrieval),
      transport,
      model: clientConfig.client.model,
      displayName: clientConfig.client.displayName,
    };
    return { ctx, transport };
  };
  // 查詢本身可能就是看不到的段落文字，所以只檢查 <passages> 區段（內容都已跳脫，第一個 </passages> 就是結尾）
  const passagesSection = (transport: ReturnType<typeof fakeTransport>, i: number) => {
    const content = transport.bodies[i].messages[0].content;
    return content.slice(0, content.indexOf("</passages>"));
  };

  // 每個身分逐一提問，回傳不符合 oracle 的地方，以及送出的 superseded-by 個數
  async function check(database: Database, identities = IDENTITIES) {
    const found: string[] = [];
    let attributes = 0;
    for (const id of identities) {
      const expected = supersede(id);
      const { ctx, transport } = context(database);
      for (const q of QUERIES) {
        const sent = transport.bodies.length;
        const answer = await ask(ctx, { identityId: id, text: q, language: "zh-TW" });
        if (answer.kind !== "answer") continue;
        const user = passagesSection(transport, sent);
        const blocks = user.match(/<passage [^>]*>/g)!;
        answer.numbering.forEach((p, i) => {
          const by = blocks[i].match(/superseded-by="(\d+)"/)?.[1];
          const actual = by === undefined ? undefined : answer.numbering[Number(by) - 1];
          const shouldBe = answer.numbering.includes(expected.get(p) ?? "") ? expected.get(p) : undefined;
          if (actual !== shouldBe) found.push(`${id}：${p} 標示 ${actual}，應為 ${shouldBe}`);
          if (by !== undefined) attributes++;
        });
        if (id !== "manager") for (const text of confidential) if (user.includes(text)) found.push(`${id}：送出 ${text}`);
      }
    }
    return { found, attributes };
  }

  it("每個身分 × 每個查詢：superseded-by 正好等於看得到的取代，且沒有機密文件的標題與內容", async () => {
    const { found, attributes } = await check(db);
    expect(found).toEqual([]);
    expect(attributes).toBeGreaterThan(0);
  });

  it("取代不外流：主管以機密段落取代的公開段落，一般員工的 prompt 沒有任何標示；主管則有", async () => {
    const profile = textOf(PROFILE);
    const user = async (id: string) => {
      const { ctx, transport } = context(db);
      await ask(ctx, { identityId: id, text: profile, language: "zh-TW" });
      return passagesSection(transport, 0);
    };
    for (const id of ["guest", "staff"]) {
      const content = await user(id);
      expect(content, id).toContain(escapeText(profile));
      expect(content, id).not.toContain("superseded-by");
      expect(content, id).not.toContain(escapeText(UPLOADS.dm.title));
    }
    const manager = await user("manager");
    expect(manager).toMatch(/<passage number="(\d+)"[^>]*superseded-by="\d+">\n範例公司是一家/);
    expect(manager).toContain(`title="${escapeText(UPLOADS.dm.title)}"`);
  });

  it("反向驗證：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    const { found } = await check(ignoring, ["staff"]);
    expect(found.some((f) => f.includes("標示"))).toBe(true);
    expect(found.some((f) => f.includes("送出"))).toBe(true);
  });
});
