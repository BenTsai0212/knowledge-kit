// target 測試（#83 決定 4）：npm test 以 client/ 執行，客戶檢查（npm run check:clients）以選定的客戶執行，
// 所以新增語言的客戶也會檢查該語言的檢索。
// scenarios.json 的預設問題：以情境的角色檢索，答案段落要在前 K 名內（K 為 client.json 的設定）。
// #22 決定 2：每題以 client.json 的每種語言各檢索一次，只要求與問題同語言的答案段落。
// 一律以 keyword-hash 檢索（#175）：CI 不下載語意模型，跨語言檢索由人在瀏覽器確認（docs/client-config.md「客戶檢查」）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import type { RetrievalConfig } from "../client/types";
import { dataset } from "../dataset/load";
import { seedDataset } from "../dataset/seed";
import { openDatabase, type Database } from "../db/database";
import { DEFAULT_PROVIDER, RETRIEVAL_DEFAULTS } from "./providers";
import { openRetriever, type Retriever } from "./retrieve";
import { scenarioCases, uncoveredCases, type ScenarioCase } from "./scenario-cases";

const LANGUAGES = clientConfig.client.languages;
const passageLanguage = new Map(
  Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => [p.id, p.language ?? d.language] as const)),
);
const cases = scenarioCases(clientConfig.scenarios, LANGUAGES, passageLanguage);
const label = (c: ScenarioCase) => `${c.question}（${c.language}）`;

// keyword-hash 的客戶照自己的設定；其他實作的客戶 topK 沿用設定，minScore 用 keyword-hash 的預設值（語意模型的門檻對它太高）
const keywordHash = clientConfig.client.retrieval.provider === DEFAULT_PROVIDER;
const retrieval: RetrievalConfig = keywordHash
  ? clientConfig.client.retrieval
  : { ...clientConfig.client.retrieval, provider: DEFAULT_PROVIDER, minScore: RETRIEVAL_DEFAULTS[DEFAULT_PROVIDER].minScore };

let db: Database;
let retriever: Retriever;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  retriever = openRetriever(db, retrieval);
});
afterAll(async () => {
  await db.close();
});

describe(`預設問題：同語言的答案段落在前 ${retrieval.topK} 名內`, () => {
  it.each(cases.filter((c) => c.expected.length > 0).map((c) => [label(c), c] as const))("%s", async (_name, c) => {
    const ids = (await retriever.retrieve(c.role, c.text!)).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(c.expected));
  });
});

// 每題在每種語言都有問題文字（參考情境見 #26）。keyword-hash 不能跨語言，每種語言都要有同語言的答案段落；
// 語意向量的客戶至少一種語言要有，CI 才至少檢索一次（#175）
it(keywordHash ? "每題在每種語言都有同語言的答案段落" : "每題在每種語言都有問題文字，且至少一種語言有同語言的答案段落", () => {
  const uncovered = uncoveredCases(cases, keywordHash);
  expect([...uncovered.cases.map(label), ...uncovered.questions]).toEqual([]);
  expect(cases).toHaveLength(clientConfig.scenarios.scenarios.flatMap((s) => s.questions).length * LANGUAGES.length);
});
