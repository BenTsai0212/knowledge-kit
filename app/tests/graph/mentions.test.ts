// 「回答提到」的權限（#195）：即使回答引用了所有段落、寫出了所有實體的名稱（模型可能寫出看不到的名稱），
// 列出的實體也只能是 oracle.ts 算出該身分看得到的實體。圖譜一律以 readGraph() 經 RLS 讀出。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { readGraph } from "../../src/graph/read";
import type { Answer } from "../../src/qa/answer";
import { mentionedEntities } from "../../src/ui/mentions";
import { datasetSample, expectedVisible } from "../../src/evals/oracle";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];
const sample = datasetSample(dataset);
const allPassages = Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => p.id));
const allNames = dataset.entities.entities.flatMap((e) => [e.name, ...Object.values(e.names)]);
// 引用所有段落（含看不到的）、寫出所有實體名稱的回答
const everything: Answer = {
  kind: "answer",
  text: allNames.join("、"),
  numbering: allPassages,
  cited: allPassages,
  dropped: [],
  uncited: false,
  incomplete: false,
};

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

const mentioned = async (id: string | null) => mentionedEntities(await readGraph(db, id), everything).map((e) => e.id).sort();

describe("回答提到的權限", () => {
  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：列出的實體正好是看得到的實體", async (_name, id) => {
    expect(await mentioned(id)).toEqual([...expectedVisible(access, sample, id).entities].sort());
  });

  it("權限越大列得越多（防止以空結果通過）", async () => {
    const [g, s, m] = await Promise.all(["guest", "staff", "manager"].map(async (id) => (await mentioned(id)).length));
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(s);
    expect(s).toBeLessThan(m);
  });
});
