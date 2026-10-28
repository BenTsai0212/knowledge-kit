// 參考情境資料集（client/data/）：內容涵蓋、預設問題的答案、以資料集計算的滲漏矩陣（#15）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { diff, queryVisible } from "../db/matrix";
import { expectedVisible } from "../db/oracle";
import type { Sample } from "../db/sample";

const { access, knowledgeModel, scenarios } = clientConfig;
const documents = Object.values(dataset.documents);
const passages = documents.flatMap((d) =>
  d.passages.map((p) => ({
    ...p,
    doc: d,
    language: p.language ?? d.language,
    level: p.visibility ?? d.visibility,
    project: p.project ?? d.project ?? null,
  })),
);
const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));

// 把資料集轉成 oracle.ts 的輸入形狀（套用段落的沿用規則）
const asSample: Sample = {
  docs: documents.map((d) => ({ id: d.id, level: d.visibility, project: d.project ?? null })),
  passages: passages.map((p) => ({ id: p.id, doc: p.doc.id, level: p.level, project: p.project })),
  entities: dataset.entities.entities.map((e) => ({ id: e.id, sources: e.sources })),
  relations: dataset.relations.relations.map((r) => ({ id: r.id, from: r.from, to: r.to, sources: r.sources })),
};
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

describe("內容涵蓋", () => {
  // 比例以段落數計算：檢索與問答的對象是段落（#26 決定，取代 #15 以文件數計算）
  it("繁中與英文的文件與段落都有，段落的繁中約占六成", () => {
    const zh = passages.filter((p) => p.language === "zh-TW").length;
    expect(new Set(documents.map((d) => d.language))).toEqual(new Set(["zh-TW", "en"]));
    expect(new Set(passages.map((p) => p.language))).toEqual(new Set(["zh-TW", "en"]));
    expect(zh / passages.length).toBeGreaterThanOrEqual(0.55);
    expect(zh / passages.length).toBeLessThanOrEqual(0.7);
  });

  it("涵蓋三種可見等級、兩個專案、沒有專案的文件，以及比所屬文件更機密的段落", () => {
    expect(new Set(documents.map((d) => d.visibility))).toEqual(new Set(access.visibilityLevels.map((l) => l.id)));
    expect(new Set(documents.flatMap((d) => (d.project ? [d.project] : [])))).toEqual(new Set(access.projects.map((p) => p.id)));
    expect(documents.some((d) => d.project === undefined)).toBe(true);
    const stricter = passages.filter(
      (p) => rank.get(p.level)! > rank.get(p.doc.visibility)! || (p.doc.project === undefined && p.project !== null),
    );
    expect(stricter.map((p) => p.id)).toEqual(
      expect.arrayContaining(["bluewing-kickoff-zh-03", "longpier-progress-zh-03", "org-chart-zh-05"]),
    );
  });

  it("每份文件都有日期（決定 2）", () => {
    expect(documents.filter((d) => !d.date).map((d) => d.id)).toEqual([]);
  });

  it("文件日期寫入資料庫；在 SQL 中轉成字串讀出，與資料集完全相同（不經過 Date，不受時區影響，#31）", async () => {
    const rows = await db.withIdentity("manager", async (tx) =>
      (await tx.query<{ id: string; date: string | null }>("SELECT id, to_char(document_date, 'YYYY-MM-DD') AS date FROM kk.documents")).rows,
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.date]))).toEqual(Object.fromEntries(documents.map((d) => [d.id, d.date ?? null])));
  });

  it("使用知識模型的每種實體與關係類型", () => {
    expect(new Set(dataset.entities.entities.map((e) => e.type))).toEqual(new Set(knowledgeModel.entityTypes.map((t) => t.id)));
    expect(new Set(dataset.relations.relations.map((r) => r.type))).toEqual(new Set(knowledgeModel.relationTypes.map((t) => t.id)));
  });

  it("同名但不同人：兩個「林志明」是不同的實體，分屬不同部門", () => {
    const lins = dataset.entities.entities.filter((e) => e.name === "林志明");
    expect(lins.map((e) => e.id).sort()).toEqual(["person-lin-zhiming-rd", "person-lin-zhiming-sales"]);
    const teamOf = (id: string) =>
      dataset.relations.relations.find((r) => r.type === "member-of" && r.from === id)?.to;
    expect(new Set(lins.map((e) => teamOf(e.id)))).toEqual(new Set(["team-rd", "team-sales"]));
    // 人物的合併策略預設送審，避免把這兩位合成同一個人（docs/client-config.md）
    expect(knowledgeModel.entityTypes.find((t) => t.id === "person")?.mergeStrategy).toBe("review");
    // 青翼專案英文段落中的 Zhiming Lin 是研發部那位（#26 決定）
    const [rd, sales] = ["person-lin-zhiming-rd", "person-lin-zhiming-sales"].map((id) => lins.find((e) => e.id === id)!);
    expect(rd.sources).toContain("bluewing-spec-en-04");
    expect(sales.sources).not.toContain("bluewing-spec-en-04");
  });

  it("中英文別名：人物的中文名與英文名，兩種語言的文件都是出處", () => {
    const people = dataset.entities.entities.filter((e) => e.type === "person");
    for (const person of people) {
      expect(person.name, person.id).toMatch(/\p{Script=Han}/u);
      expect(person.aliases?.some((a) => /^[A-Za-z][A-Za-z .'-]+$/.test(a)), person.id).toBe(true);
    }
    const lang = new Map(passages.map((p) => [p.id, p.language]));
    const bilingual = people.filter((p) => new Set(p.sources.map((s) => lang.get(s))).size === 2);
    expect(bilingual.length).toBeGreaterThanOrEqual(5);
  });

  it("矛盾：青翼桌的上市時間，中文與英文都由較新的另一份文件改口（docs/dataset.md）", () => {
    const question = scenarios.scenarios.flatMap((s) => s.questions).find((q) => q.id === "bluewing-launch")!;
    const sources = question.answerPassages.map((id) => passages.find((p) => p.id === id)!);
    const quarter = (text: string) =>
      /第二季|second quarter/.test(text) ? "Q2" : /第三季|third quarter/.test(text) ? "Q3" : "?";
    expect(sources.map((p) => [p.language, p.doc.date, quarter(p.text)])).toEqual([
      ["zh-TW", "2026-02-10", "Q2"],
      ["zh-TW", "2026-05-15", "Q3"],
      ["en", "2026-03-03", "Q2"],
      ["en", "2026-05-15", "Q3"],
    ]);
    // 同一語言的兩種說法來自不同文件，問答以文件標題並列來源
    for (const language of ["zh-TW", "en"]) {
      expect(new Set(sources.filter((p) => p.language === language).map((p) => p.doc.id)).size, language).toBe(2);
    }
  });
});

describe("預設問題的答案", () => {
  const cases = scenarios.scenarios.flatMap((s) => s.questions.map((q) => [`${s.id}/${q.id}`, s.role, q.answerPassages] as const));

  it.each(cases)("%s：答案段落存在，且該情境的角色看得到", async (_name, role, answers) => {
    expect(answers.filter((id) => !passages.some((p) => p.id === id))).toEqual([]);
    expect(expectedVisible(access, asSample, role).passages).toEqual(expect.arrayContaining([...answers]));
    const seen = await db.withIdentity(role, async (tx) =>
      (await tx.query<{ id: string }>("SELECT id FROM kk.passages WHERE id = ANY($1)", [answers])).rows.map((r) => r.id),
    );
    expect(seen.sort()).toEqual([...answers].sort());
  });
});

describe("滲漏矩陣（資料集）", () => {
  it("每個身分 × 每張表：滲漏 0、漏看 0", async () => {
    const report: string[] = [];
    let leaked = 0;
    let missing = 0;
    for (const id of IDENTITIES) {
      const expected = expectedVisible(access, asSample, id);
      for (const r of diff(await queryVisible(db, id), expected)) {
        leaked += r.leaked.length;
        missing += r.missing.length;
        expect(r.leaked, `${id} 在 ${r.table} 看到不該看到的列`).toEqual([]);
        expect(r.missing, `${id} 在 ${r.table} 漏看該看到的列`).toEqual([]);
      }
      report.push(`${String(id).padEnd(8)} ${["documents", "passages", "entities", "relations"].map((t) => `${t}=${expected[t].length}`).join(" ")}`);
    }
    console.log(`資料集：權限滲漏 ${leaked}、漏看 ${missing}\n${report.join("\n")}`);
    expect({ leaked, missing }).toEqual({ leaked: 0, missing: 0 });
  });

  it("權限越大看得越多", () => {
    for (const table of ["documents", "passages", "entities", "relations"]) {
      const [g, s, m] = ["guest", "staff", "manager"].map((id) => expectedVisible(access, asSample, id)[table].length);
      expect(g, table).toBeGreaterThan(0);
      expect(g, table).toBeLessThan(s);
      expect(s, table).toBeLessThan(m);
    }
  });
});
