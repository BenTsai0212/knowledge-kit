// 拒答的「可以試試」的權限（#285、#247）：問題提到任何實體（包括看不到的）時，建議中的實體與負責人
// 只能是 oracle.ts 算出該身分看得到的實體；只提到看不到的實體時，與資料不存在的問題相同（通用建議）。圖譜一律以 readGraph() 經 RLS 讀出。
// 拒答後先確認要找的是哪一種（#377）：選了之後的下一步與略過時的清單也一樣。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { datasetSample, expectedVisible } from "../../src/evals/oracle";
import { readGraph } from "../../src/graph/read";
import { REFUSAL_CHOICES, refusalChoiceNext, refusalNextSteps, type RefusalChoiceNext, type RefusalSuggestion } from "../../src/ui/refusal-next-steps";

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
const chosenEntities = (next: RefusalChoiceNext): string[] => {
  if (next.choice === "skip") return mentioned(next.steps);
  if (next.choice === "personal") return [];
  const owner = next.owner === null ? [] : [next.owner.entity.id, next.owner.owner.id];
  return next.choice === "people" && next.entity !== null ? [next.entity.id, ...owner] : owner;
};

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

  // 先確認要找的是哪一種（#377）：選了之後的下一步同樣只含看得到的實體；只提到看不到的實體時，每個選項都與資料沒寫的問題相同
  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：選了之後的下一步只含看得到的實體，且與資料沒寫相同", async (_name, id) => {
    const graph = await readGraph(db, id);
    const visible = new Set(expectedVisible(access, sample, id).entities);
    const allNames = entities.flatMap(namesOf);
    for (const language of LANGUAGES) {
      for (const choice of [...REFUSAL_CHOICES, "skip"] as const) {
        for (const question of [...allNames, allNames.join("、")]) {
          const next = refusalChoiceNext(choice, { canUpload: true, graph, question, language });
          for (const e of chosenEntities(next)) expect(visible.has(e), `${choice} ${question} → ${e}`).toBe(true);
        }
        const expected = refusalChoiceNext(choice, { canUpload: false, graph, question: NOT_WRITTEN, language });
        for (const name of hiddenNames(id)) expect(refusalChoiceNext(choice, { canUpload: false, graph, question: `${name}的資料`, language }), `${choice} ${name}`).toEqual(expected);
      }
    }
  });

  it("有身分能以看不到的實體的名稱提問（防止以空結果通過）", () => {
    expect(IDENTITIES.some((id) => hiddenNames(id).length > 0)).toBe(true);
  });
});
