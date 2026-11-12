// 大量節點時的分群與聚合線的權限（#254、#247）：泡泡的實體數與聚合線的段數只計算目前身分看得到的實體與關係。
// 對每個身分（3 個角色、null、不存在的身分）以 oracle.ts 算出的可見範圍比對，容器分群與社群偵測都檢查。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { datasetSample } from "../../src/evals/oracle";
import { aggregateEdges, clusterGraph, filterGraph, type ClusterModel } from "../../src/graph/clusters";
import { readGraph, type Graph } from "../../src/graph/read";
import { viewOf } from "../../src/ui/graph-zoom";
import { expectedVisible } from "../db/oracle";

const { access, knowledgeModel } = clientConfig;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];
const sample = datasetSample(dataset);
const MODELS: [string, ClusterModel][] = [
  ["容器", knowledgeModel],
  ["社群偵測", { entityTypes: knowledgeModel.entityTypes.map(({ id }) => ({ id })) }],
];
const CASES = IDENTITIES.flatMap((id) => MODELS.map(([name, model]) => [`${String(id)}／${name}`, id, model] as const));

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

const visibleOf = (id: string | null) => {
  const v = expectedVisible(access, sample, id);
  return { entities: new Set(v.entities), relations: new Set(v.relations) };
};

// 泡泡與聚合線上的數字：各群的實體數、類型組成，以及每條聚合線的段數
function numbers(graph: Graph, model: ClusterModel) {
  const clustering = clusterGraph(graph, model);
  const edges = aggregateEdges(graph, clustering);
  return { clustering, edges, members: clustering.clusters.reduce((n, c) => n + c.members.length, 0) };
}

describe("分群與聚合線的權限", () => {
  it.each(CASES)("%s：群內的實體正好是看得到的實體，聚合線只含看得到的關係", async (_name, id, model) => {
    const visible = visibleOf(id);
    const { clustering, edges, members } = numbers(await readGraph(db, id), model);
    expect(clustering.clusters.flatMap((c) => c.members).sort()).toEqual([...visible.entities].sort());
    expect(members).toBe(visible.entities.size);
    for (const c of clustering.clusters) {
      expect(c.composition.reduce((n, t) => n + t.count, 0)).toBeLessThanOrEqual(c.members.length);
      if (c.anchor !== null) expect(visible.entities.has(c.anchor)).toBe(true);
      expect(visible.entities.has(c.id) || c.id === "other" || c.id.startsWith("community:")).toBe(true);
    }
    const segments = edges.flatMap((e) => e.relations);
    for (const r of segments) expect(visible.relations.has(r), `${String(id)} 的聚合線含 ${r}`).toBe(true);
    expect(new Set(segments).size).toBe(segments.length);
    expect(segments.length).toBeLessThanOrEqual(visible.relations.size);
  });

  it.each(CASES)("%s：篩選後重新分群，仍只含看得到的實體", async (_name, id, model) => {
    const visible = visibleOf(id);
    const filtered = filterGraph(await readGraph(db, id), { types: new Set(["person", "project"]), minRelations: 2 });
    const { clustering, edges } = numbers(filtered, model);
    for (const e of clustering.clusters.flatMap((c) => c.members)) expect(visible.entities.has(e)).toBe(true);
    for (const r of edges.flatMap((x) => x.relations)) expect(visible.relations.has(r)).toBe(true);
  });

  it.each(MODELS)("切換身分時數字跟著變（%s；防止以空結果通過）", async (_name, model) => {
    const [guest, staff, manager] = await Promise.all(["guest", "staff", "manager"].map(async (id) => numbers(await readGraph(db, id), model)));
    expect(guest!.members).toBeGreaterThan(0);
    expect(guest!.members).toBeLessThan(staff!.members);
    expect(staff!.members).toBeLessThan(manager!.members);
    const segments = (n: typeof guest) => n!.edges.reduce((s, e) => s + e.relations.length, 0);
    expect(segments(guest)).toBeLessThanOrEqual(segments(manager));
    // 主管看得到的群組，在看得較少的身分下實體數不會比較多
    for (const c of guest!.clustering.clusters.filter((c) => c.kind === "container")) {
      const m = manager!.clustering.clusters.find((x) => x.id === c.id);
      expect(m?.members.length ?? 0).toBeGreaterThanOrEqual(c.members.length);
    }
  });

  it.each(CASES)("%s：畫在圖上的泡泡與線（全覽、各群組層）只含看得到的實體與關係", async (_name, id, model) => {
    const visible = visibleOf(id);
    const graph = await readGraph(db, id);
    const clustering = clusterGraph(graph, model);
    for (const open of [new Set<string>(), ...clustering.clusters.map((c) => new Set(c.members))]) {
      const view = viewOf(graph, clustering, open);
      for (const e of view.entities) expect(visible.entities.has(e)).toBe(true);
      for (const r of view.edges.flatMap((x) => x.relations)) expect(visible.relations.has(r)).toBe(true);
      const drawn = view.entities.length + view.bubbles.reduce((n, c) => n + clustering.clusters.find((x) => x.id === c)!.members.filter((m) => !open.has(m)).length, 0);
      expect(drawn).toBe(visible.entities.size);
    }
  });

  it("不存在的身分沒有任何群組與聚合線", async () => {
    const { clustering, edges } = numbers(await readGraph(db, "nobody"), knowledgeModel);
    expect(clustering.clusters).toEqual([]);
    expect(edges).toEqual([]);
  });
});
