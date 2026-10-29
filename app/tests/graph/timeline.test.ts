// 時間軸的權限與內容：每個身分 × 每種語言 × 每個實體篩選，結果正好等於 oracle 算出的可見範圍。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { readTimeline, type TimelineEntry } from "../../src/graph/timeline";
import { datasetSample } from "../db/dataset-sample";
import { expectedVisible } from "../db/oracle";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];
const LANGUAGES = clientConfig.client.languages;
const documents = Object.values(dataset.documents);
const FILTERS = [undefined, ...dataset.entities.entities.map((e) => e.id)];

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

// 結果轉成「文件|段落」的鍵
const keysOf = (entries: TimelineEntry[]) => entries.flatMap((e) => e.passages.map((p) => `${e.documentId}|${p.id}`)).sort();

// oracle：看得到的段落中，屬於該語言文件的；篩選時只留以該實體為出處的段落（出處列要看得到）
function expectedKeys(identityId: string | null, language: string, entityId?: string): string[] {
  const visible = expectedVisible(access, datasetSample, identityId);
  const passages = new Set(visible.passages);
  const sources = new Set(visible.entity_sources);
  return documents
    .filter((d) => d.language === language)
    .flatMap((d) =>
      d.passages
        .filter((p) => passages.has(p.id) && (entityId === undefined || sources.has(`${entityId}|${p.id}`)))
        .map((p) => `${d.id}|${p.id}`),
    )
    .sort();
}

describe("readTimeline 的權限", () => {
  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：每種語言 × 每個實體篩選，正好等於可見範圍", async (_name, id) => {
    for (const language of LANGUAGES) {
      for (const entityId of FILTERS) {
        expect(keysOf(await readTimeline(db, id, { language, entityId })), `${language} ${entityId}`).toEqual(expectedKeys(id, language, entityId));
      }
    }
  });

  it("段落的 entityIds 只包含看得到的實體", async () => {
    for (const id of ["guest", "staff", "manager"]) {
      const entities = new Set(expectedVisible(access, datasetSample, id).entities);
      for (const language of LANGUAGES) {
        const ids = (await readTimeline(db, id, { language })).flatMap((e) => e.passages.flatMap((p) => p.entityIds));
        expect(ids.filter((e) => !entities.has(e)), `${id} ${language}`).toEqual([]);
      }
    }
  });

  it("權限越大看得越多（防止以空結果通過）", async () => {
    const counts = await Promise.all(["guest", "staff", "manager"].map(async (id) => keysOf(await readTimeline(db, id, { language: "zh-TW" })).length));
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
  });

  it("檢查能抓到滲漏：忽略身分、一律以主管查詢的資料層會被抓到", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    for (const id of ["guest", "staff", null]) {
      expect(keysOf(await readTimeline(ignoring, id, { language: "zh-TW" })), String(id)).not.toEqual(expectedKeys(id, "zh-TW"));
    }
  });
});

describe("readTimeline 的內容", () => {
  it("只列出介面語言的文件，依日期由新到舊（#42）；日期與資料集的字串完全相同", async () => {
    for (const language of LANGUAGES) {
      const entries = await readTimeline(db, "manager", { language });
      expect(entries.every((e) => e.language === language)).toBe(true);
      expect(entries.map((e) => e.date)).toEqual(entries.map((e) => e.date).sort().reverse());
      for (const e of entries) {
        const doc = documents.find((d) => d.id === e.documentId)!;
        expect(e.date, e.documentId).toBe(doc.date);
        // 可見等級與專案（畫面上的標籤，#48）
        expect([e.visibility, e.project], e.documentId).toEqual([doc.visibility, doc.project ?? null]);
      }
    }
  });

  it("段落依文件中的順序，內容與資料集相同", async () => {
    for (const e of await readTimeline(db, "manager", { language: "zh-TW" })) {
      const doc = documents.find((d) => d.id === e.documentId)!;
      expect(e.passages.map((p) => [p.id, p.content])).toEqual(doc.passages.map((p) => [p.id, p.text]));
    }
  });

  it.each([
    ["zh-TW", /第二季/, /第三季/],
    ["en", /second quarter/, /third quarter/],
  ] as const)("青翼專案（%s）：較新的第三季排在較舊的第二季之前", async (language, q2, q3) => {
    const entries = await readTimeline(db, "staff", { language, entityId: "project-bluewing" });
    const launch = entries.flatMap((e) => e.passages.filter((p) => q2.test(p.content) || q3.test(p.content)).map((p) => ({ date: e.date, q3: q3.test(p.content) })));
    expect(launch).toHaveLength(2);
    expect(launch.map((x) => x.q3)).toEqual([true, false]);
    expect(launch[0].date! > launch[1].date!).toBe(true);
  });

  it("沒有日期的文件排在最後；日期相同時依文件 id", async () => {
    const { uploadDocument } = await import("../../src/upload/write");
    const dated = { title: "x", language: "zh-TW", visibility: "public", project: null, passages: ["虛構的測試段落。"] };
    const options = { languages: clientConfig.client.languages };
    const a = await uploadDocument(db, "manager", { ...dated, date: null }, options);
    const b = await uploadDocument(db, "manager", { ...dated, date: "2099-01-01" }, options);
    const c = await uploadDocument(db, "manager", { ...dated, date: "2099-01-01" }, options);
    const ids = (await readTimeline(db, "manager", { language: "zh-TW" })).map((e) => e.documentId);
    expect(ids[0]).toBe([b.documentId, c.documentId].sort()[0]);
    expect(ids[1]).toBe([b.documentId, c.documentId].sort()[1]);
    expect(ids.at(-1)).toBe(a.documentId);
  });
});
