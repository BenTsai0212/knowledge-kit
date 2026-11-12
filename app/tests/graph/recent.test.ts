// 首頁清單的權限（#283，#247）：「最近新增的文件」與「最近看過」的實體只含目前身分看得到的；
// 不同身分的首頁不含看不到的文件與實體（與 oracle.ts 比對，滲漏 0）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import type { LanguageCode } from "../../src/client/types";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { readEntitiesByIds, readRecentDocuments, RECENT_DOCUMENTS } from "../../src/graph/recent";
import { uploadDocument } from "../../src/upload/write";
import { datasetSample } from "../db/dataset-sample";
import { expectedVisible } from "../db/oracle";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];
const LANGUAGES = clientConfig.client.languages;
const sample = datasetSample;
const documents = Object.values(dataset.documents);
const ALL = 10_000;

// 介面語言、且有看得到的段落的文件（與時間軸相同）
function expectedDocuments(identityId: string | null, language: LanguageCode): string[] {
  const v = expectedVisible(access, sample, identityId);
  const passages = new Set(v.passages);
  return documents
    .filter((d) => d.language === language && d.passages.some((p) => passages.has(p.id)))
    .map((d) => d.id)
    .sort();
}

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

describe("readRecentDocuments 的權限", () => {
  const cases = IDENTITIES.flatMap((id) => LANGUAGES.map((language) => [`${String(id)} · ${language}`, id, language] as const));

  it.each(cases)("%s：全部列出時正好等於看得到的文件", async (_name, id, language) => {
    const rows = await readRecentDocuments(db, id, language, ALL);
    expect(rows.map((d) => d.id).sort()).toEqual(expectedDocuments(id, language));
  });

  it.each(cases)("%s：首頁只列前幾筆，且都看得到", async (_name, id, language) => {
    const rows = await readRecentDocuments(db, id, language);
    const visible = expectedDocuments(id, language);
    expect(rows.length).toBe(Math.min(RECENT_DOCUMENTS, visible.length));
    for (const d of rows) expect(visible).toContain(d.id);
  });

  it("權限越大看得越多（防止以空結果通過）", async () => {
    const language = clientConfig.client.defaultLanguage;
    const [g, s, m] = await Promise.all(["guest", "staff", "manager"].map(async (id) => (await readRecentDocuments(db, id, language, ALL)).length));
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(s);
    expect(s).toBeLessThan(m);
  });

  it("依文件日期由新到舊，沒有日期的排在最後", async () => {
    const rows = await readRecentDocuments(db, "manager", clientConfig.client.defaultLanguage, ALL);
    const dates = rows.map((d) => d.date ?? "");
    const dated = dates.filter((d) => d !== "");
    expect(dated).toEqual([...dated].sort().reverse());
    expect(dates.slice(dated.length).every((d) => d === "")).toBe(true);
  });
});

describe("readEntitiesByIds 的權限", () => {
  const ids = [...dataset.entities.entities.map((e) => e.id), "no-such-entity"];

  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：正好等於看得到的實體，順序依傳入的 id", async (_name, id) => {
    const visible = new Set(expectedVisible(access, sample, id).entities);
    const rows = await readEntitiesByIds(db, id, ids);
    expect(rows.map((e) => e.id)).toEqual(ids.filter((x) => visible.has(x)));
  });

  it("訪客看得到的實體比主管少（防止以空結果通過）", async () => {
    const [g, m] = await Promise.all(["guest", "manager"].map(async (id) => (await readEntitiesByIds(db, id, ids)).length));
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(m);
  });

  it("沒有 id 時不讀取", async () => {
    expect(await readEntitiesByIds(db, "manager", [])).toEqual([]);
  });
});

describe("上傳的文件", () => {
  let upload: Database;
  beforeAll(async () => {
    upload = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  });
  afterAll(async () => {
    await upload.close();
  });

  it("排在資料集之前；只有看得到的身分列得出來", async () => {
    const language = clientConfig.client.defaultLanguage;
    const input = (visibility: string, project: string | null) => ({
      title: "虛構的上傳文件",
      language,
      visibility,
      project,
      date: "2000-01-01",
      passages: ["這是一段虛構的測試內容。"],
    });
    const options = { languages: LANGUAGES };
    const staffDoc = await uploadDocument(upload, "staff", input("internal", "bluewing"), options);
    const managerDoc = await uploadDocument(upload, "manager", input("confidential", "longpier"), options);

    const ids = async (id: string | null) => (await readRecentDocuments(upload, id, language)).map((d) => d.id);
    expect((await ids("manager")).slice(0, 2).sort()).toEqual([staffDoc.documentId, managerDoc.documentId].sort());
    expect((await ids("staff"))[0]).toBe(staffDoc.documentId);
    expect(await ids("staff")).not.toContain(managerDoc.documentId);
    for (const id of ["guest", null, "nobody"]) {
      expect(await ids(id)).not.toContain(staffDoc.documentId);
      expect(await ids(id)).not.toContain(managerDoc.documentId);
    }
  });
});
