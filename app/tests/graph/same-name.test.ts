// 同名的反問的權限（ADR 0012 決定 1、#247）：選項只能是 oracle.ts 算出該身分看得到的實體；
// 只看得到一位同名的身分不反問（不透露另一位的存在）。圖譜一律以 readGraph() 經 RLS 讀出。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { readGraph } from "../../src/graph/read";
import { sameNameAsk } from "../../src/ui/same-name";
import { datasetSample, expectedVisible } from "../../src/evals/oracle";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];
const sample = datasetSample(dataset);
// 參考情境中同類型、同名的實體（兩位林志明）
const LIN = dataset.entities.entities.filter((e) => e.type === "person" && e.name === "林志明").map((e) => e.id);
const LANGUAGES = clientConfig.client.languages;

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

describe("同名的反問的權限", () => {
  it("參考情境有兩位同名的林志明（防止以空結果通過）", () => {
    expect(LIN).toHaveLength(2);
  });

  it.each(IDENTITIES.flatMap((id) => LANGUAGES.map((language) => [`${String(id)}／${language}`, id, language] as const)))(
    "%s：看得到兩位才反問，選項正好是看得到的那幾位",
    async (_name, id, language) => {
      const graph = await readGraph(db, id);
      const seen = expectedVisible(access, sample, id).entities;
      const visible = LIN.filter((e) => seen.includes(e));
      const name = language === "en" ? "Zhiming Lin" : "林志明";
      const ask = sameNameAsk(graph, `${name}負責哪些專案？`, language);
      if (visible.length < 2) expect(ask).toBeNull();
      else expect(ask?.options.map((o) => o.entityId).sort()).toEqual([...visible].sort());
    },
  );

  it("至少一個身分會反問、至少一個身分不反問", async () => {
    const asks = await Promise.all(IDENTITIES.map(async (id) => sameNameAsk(await readGraph(db, id), "林志明負責哪些專案？", "zh-TW")));
    expect(asks.some((a) => a !== null)).toBe(true);
    expect(asks.some((a) => a === null)).toBe(true);
  });
});
