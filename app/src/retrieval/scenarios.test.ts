// client/scenarios.json 的預設問題：以情境的角色檢索，答案段落要在前 K 名內（K 為 client.json 的設定）。
// #22 決定 2：每題以中文與英文各檢索一次，只要求與問題同語言的答案段落；跨語言檢索是第 2 階段。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import { seedDataset } from "../dataset/seed";
import { openDatabase, type Database } from "../db/database";
import { openRetriever, type Retriever } from "./retrieve";

const LANGUAGES = clientConfig.client.languages;
const passageLanguage = new Map(
  Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => [p.id, p.language ?? d.language] as const)),
);

const cases = clientConfig.scenarios.scenarios.flatMap((s) =>
  s.questions.flatMap((q) =>
    LANGUAGES.map((language) => ({
      name: `${q.id}（${language}）`,
      role: s.role,
      text: q.text[language],
      language,
      expected: q.answerPassages.filter((id) => passageLanguage.get(id) === language),
      all: q.answerPassages,
    })),
  ),
);

// 答案段落只有中文、沒有英文的題目：英文問題需要跨語言檢索（第 2 階段），本階段不檢查
const CROSS_LANGUAGE = ["bluewing-lead（en）", "bluewing-launch（en）", "longpier-status（en）", "raise-2026（en）"];

let db: Database;
let retriever: Retriever;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  retriever = openRetriever(db, clientConfig.client.retrieval);
});
afterAll(async () => {
  await db.close();
});

describe(`預設問題：同語言的答案段落在前 ${clientConfig.client.retrieval.topK} 名內`, () => {
  it.each(cases.filter((c) => c.expected.length > 0).map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const ids = (await retriever.retrieve(c.role, c.text)).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(c.expected));
  });
});

describe("跨語言（第 2 階段），本階段不檢查", () => {
  it("沒有同語言答案段落的題目正好是這 4 題", () => {
    expect(cases.filter((c) => c.expected.length === 0).map((c) => c.name)).toEqual(CROSS_LANGUAGE);
  });

  it.each(cases.filter((c) => CROSS_LANGUAGE.includes(c.name)).map((c) => [c.name, c] as const))(
    "%s：答案段落都是其他語言",
    (_name, c) => {
      expect(c.all.length).toBeGreaterThan(0);
      expect(c.all.every((id) => passageLanguage.get(id) !== c.language)).toBe(true);
    },
  );
});
