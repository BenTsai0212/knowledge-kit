// target 測試（#83 決定 4）：npm test 以 client/ 執行，客戶檢查（npm run check:clients）以選定的客戶執行，
// 所以新增語言的客戶也會檢查該語言的檢索。
// scenarios.json 的預設問題：以情境的角色檢索，答案段落要在前 K 名內（K 為 client.json 的設定）。
// #22 決定 2：每題以 client.json 的每種語言各檢索一次，只要求與問題同語言的答案段落；跨語言檢索是第 2 階段。
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
    })),
  ),
);

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

// 每題在每種語言都有問題文字與答案段落（參考情境見 #26）；跨語言檢索是第 2 階段，不能靠它通過
it("每題在每種語言都有同語言的答案段落", () => {
  expect(cases.filter((c) => c.text === undefined || c.expected.length === 0).map((c) => c.name)).toEqual([]);
  expect(cases).toHaveLength(clientConfig.scenarios.scenarios.flatMap((s) => s.questions).length * LANGUAGES.length);
});
