// 拒答的「可以試試」的權限（#285、#247）：問題提到任何實體（包括看不到的）時，建議中的實體與負責人
// 只能是 oracle.ts 算出該身分看得到的實體；只提到看不到的實體時，與資料不存在的問題相同（通用建議）。圖譜一律以 readGraph() 經 RLS 讀出。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { datasetSample, expectedVisible } from "../../src/evals/oracle";
import { readGraph } from "../../src/graph/read";
import { refusalNextSteps, type RefusalSuggestion } from "../../src/ui/refusal-next-steps";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];
const LANGUAGES = clientConfig.client.languages;
const sample = datasetSample(dataset);
const entities = dataset.entities.entities;
const namesOf = (e: (typeof entities)[number]) => [e.name, ...Object.values(e.names)].filter((n) => n.trim() !== "");
// 資料集中沒有的詞（資料沒寫）
const NOT_WRITTEN = "E2E qzxv wkjp";

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

// 看不到的實體中，名稱與看得到的實體的名稱互不包含者（否則問題同時提到看得到的實體）
function hiddenNames(id: string | null): string[] {
  const visible = new Set(expectedVisible(access, sample, id).entities);
  const visibleNames = entities.filter((e) => visible.has(e.id)).flatMap(namesOf).map((n) => n.toLowerCase());
  return entities
    .filter((e) => !visible.has(e.id))
    .flatMap(namesOf)
    .filter((n) => !visibleNames.some((v) => v.includes(n.toLowerCase()) || n.toLowerCase().includes(v)));
}

const mentioned = (list: RefusalSuggestion[]) => list.flatMap((x) => (x.kind === "step" ? [] : x.kind === "owner" ? [x.entity.id, x.owner.id] : [x.entity.id]));

describe("拒答的可以試試：只用看得到的實體", () => {
  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：問題提到任何實體時，建議只含看得到的實體", async (_name, id) => {
    const graph = await readGraph(db, id);
    const visible = new Set(expectedVisible(access, sample, id).entities);
    const allNames = entities.flatMap(namesOf);
    let withEntities = 0;
    for (const language of LANGUAGES) {
      for (const question of [...allNames, allNames.join("、")]) {
        const list = refusalNextSteps({ canUpload: true, graph, question, language });
        for (const e of mentioned(list)) expect(visible.has(e), `${question} → ${e}`).toBe(true);
        if (list.some((x) => x.kind !== "step")) withEntities++;
      }
    }
    // 防止以空結果通過：看得到實體的身分確實有從實體產生的建議
    if (visible.size > 0) expect(withEntities).toBeGreaterThan(0);
  });

  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：只提到看不到的實體時，與資料沒寫的問題相同", async (_name, id) => {
    const graph = await readGraph(db, id);
    for (const language of LANGUAGES) {
      const expected = refusalNextSteps({ canUpload: false, graph, question: NOT_WRITTEN, language });
      for (const name of hiddenNames(id)) expect(refusalNextSteps({ canUpload: false, graph, question: `${name}的資料`, language }), name).toEqual(expected);
    }
  });

  it("有身分能以看不到的實體的名稱提問（防止以空結果通過）", () => {
    expect(IDENTITIES.some((id) => hiddenNames(id).length > 0)).toBe(true);
  });
});
