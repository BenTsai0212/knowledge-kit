// 上傳後的可見範圍：上傳的文件與段落對每個身分的可見性以 oracle.ts 比對（滲漏 0、漏看 0），
// 涵蓋資料表、檢索、問答送出的內容、時間軸與原文。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { readTimeline } from "../../src/graph/timeline";
import { ask } from "../../src/qa/answer";
import { escapeText } from "../../src/qa/prompt";
import { fakeTransport } from "../../src/qa/testing";
import { openRetriever } from "../../src/retrieval/retrieve";
import { readSource } from "../../src/sources/source";
import { uploadDocument, type UploadInput } from "../../src/upload/write";
import { datasetSample } from "../db/dataset-sample";
import { diff, queryVisible } from "../db/matrix";
import { expectedVisible } from "../db/oracle";
import type { Sample } from "../db/sample";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];
const OPTIONS = { languages: clientConfig.client.languages };

// 虛構內容
const UPLOADS: { by: string; input: UploadInput }[] = [
  {
    by: "manager",
    input: {
      title: "第二組裝廠評估（虛構）",
      language: "zh-TW",
      visibility: "confidential",
      project: null,
      date: "2026-09-01",
      passages: ["範例公司評估在 2027 年設立第二組裝廠，地點尚未決定。", "第二組裝廠的預算將於年底的經營會議核定。"],
    },
  },
  {
    by: "staff",
    input: {
      title: "Bluewing Field Trial Notes (fictional)",
      language: "en",
      visibility: "internal",
      project: "bluewing",
      date: "2026-08-15",
      passages: ["Field trial users asked for a quieter motor on the Bluewing desk.", "The trial team will repeat the noise test in September."],
    },
  },
];

let db: Database;
let sample: Sample;
const uploaded: { id: string; text: string; doc: string; title: string; language: string }[] = [];

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  sample = { ...datasetSample, docs: [...datasetSample.docs], passages: [...datasetSample.passages] };
  for (const { by, input } of UPLOADS) {
    const { documentId, passageIds } = await uploadDocument(db, by, input, OPTIONS);
    sample.docs.push({ id: documentId, level: input.visibility, project: input.project });
    passageIds.forEach((id, i) => {
      sample.passages.push({ id, doc: documentId, level: input.visibility, project: input.project });
      uploaded.push({ id, text: input.passages[i], doc: documentId, title: input.title, language: input.language });
    });
  }
});
afterAll(async () => {
  await db.close();
});

const visiblePassages = (id: string | null) => new Set(expectedVisible(access, sample, id).passages);

describe("上傳後的可見範圍", () => {
  it("資料表：每個身分 × 每張表，滲漏 0、漏看 0", async () => {
    for (const id of IDENTITIES) {
      for (const r of diff(await queryVisible(db, id), expectedVisible(access, sample, id))) {
        expect(r.leaked, `${id} 在 ${r.table} 看到不該看到的列`).toEqual([]);
        expect(r.missing, `${id} 在 ${r.table} 漏看該看到的列`).toEqual([]);
      }
    }
  });

  it("上傳的段落確實區分各身分（防止以全部看不到而通過）", () => {
    const count = (id: string) => uploaded.filter((p) => visiblePassages(id).has(p.id)).length;
    expect([count("guest"), count("staff"), count("manager")]).toEqual([0, 2, 4]);
  });

  it("檢索：以上傳段落的原文查詢，看不到的不出現，看得到的排第 1 名", async () => {
    const retriever = openRetriever(db, clientConfig.client.retrieval);
    for (const id of IDENTITIES) {
      const allowed = visiblePassages(id);
      for (const p of uploaded) {
        const results = await retriever.retrieve(id, p.text);
        expect(results.filter((r) => !allowed.has(r.id)).map((r) => r.id), `${id}：${p.id}`).toEqual([]);
        if (allowed.has(p.id)) expect(results[0]?.id, `${id}：${p.id}`).toBe(p.id);
      }
    }
  });

  it("問答：送出的內容不含看不到的上傳段落與標題", async () => {
    for (const id of IDENTITIES) {
      const allowed = visiblePassages(id);
      const transport = fakeTransport();
      const ctx = {
        retriever: openRetriever(db, clientConfig.client.retrieval),
        transport,
        model: clientConfig.client.model,
        displayName: clientConfig.client.displayName,
      };
      for (const p of uploaded) await ask(ctx, { identityId: id, text: p.text, language: p.language });
      const bodies = transport.bodies.map((b) => b.messages[0].content.split("</passages>")[0]);
      for (const p of uploaded.filter((x) => !allowed.has(x.id))) {
        expect(bodies.some((b) => b.includes(escapeText(p.text)) || b.includes(`title="${escapeText(p.title)}"`)), `${id}：${p.id}`).toBe(false);
      }
      for (const p of uploaded.filter((x) => allowed.has(x.id))) {
        expect(bodies.some((b) => b.includes(escapeText(p.text))), `${id}：${p.id}`).toBe(true);
      }
    }
  });

  it("時間軸與原文：上傳的文件只對看得到的身分出現", async () => {
    for (const id of IDENTITIES) {
      const allowed = visiblePassages(id);
      for (const p of uploaded) {
        const timeline = await readTimeline(db, id, { language: p.language });
        const inTimeline = timeline.some((e) => e.passages.some((x) => x.id === p.id));
        const source = await readSource(db, id, p.id);
        expect(inTimeline, `${id} 時間軸：${p.id}`).toBe(allowed.has(p.id));
        expect(source === null, `${id} 原文：${p.id}`).toBe(!allowed.has(p.id));
        if (source) expect(source.title).toBe(p.title);
      }
    }
  });
});
