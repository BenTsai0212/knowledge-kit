// 大量節點時的門檻與分群（#254）：以虛構的大型資料（fixtures/large-graph.ts，240 個實體）驗證。
import { describe, expect, it } from "vitest";
import { dataset } from "../../src/dataset/load";
import { aggregateEdges, clusterGraph, filterGraph, labelledInCluster, OTHER_CLUSTER, scaleMode } from "../../src/graph/clusters";
import { LARGE_COUNTS, LARGE_MODEL, LARGE_MODEL_NO_CONTAINER, largeGraph, shuffled } from "../fixtures/large-graph";

const graph = largeGraph();
const models = [
  ["容器", LARGE_MODEL],
  ["社群偵測", LARGE_MODEL_NO_CONTAINER],
] as const;

describe("大型資料", () => {
  it("至少 200 個實體，同一個種子每次相同", () => {
    expect(graph.entities.length).toBeGreaterThanOrEqual(200);
    expect(largeGraph()).toEqual(graph);
  });

  it("超過桌機與手機的門檻；參考情境不超過", () => {
    expect(scaleMode(graph.entities.length, false)).toBe("overview");
    expect(scaleMode(graph.entities.length, true)).toBe("overview");
    expect(scaleMode(dataset.entities.entities.length, false)).toBe("all");
  });

  it("篩選後重新計算門檻：只留部門與專案時回到全部節點", () => {
    const containers = filterGraph(graph, { types: new Set(["team", "project"]), minRelations: 0 });
    expect(scaleMode(containers.entities.length, false)).toBe("all");
    const busy = filterGraph(graph, { types: null, minRelations: 20 });
    expect(busy.entities.length).toBeLessThan(graph.entities.length);
    expect(busy.entities.every((e) => e.type !== "person")).toBe(true);
  });
});

describe.each(models)("分群（%s）", (_name, model) => {
  const clustering = clusterGraph(graph, model);

  it("每個實體正好屬於一群，結果與輸入順序無關", () => {
    expect(clustering.clusters.flatMap((c) => c.members).sort()).toEqual(graph.entities.map((e) => e.id).sort());
    for (const seed of [1, 2, 3]) expect(clusterGraph(shuffled(graph, seed), model)).toEqual(clustering);
  });

  it("沒有關係的實體放進「其他」", () => {
    const other = clustering.clusters.find((c) => c.id === OTHER_CLUSTER);
    for (let i = 1; i <= LARGE_COUNTS.loners; i++) expect(other?.members).toContain(`person-x00${i}`);
  });

  it("聚合線的段數總和等於跨群的關係數", () => {
    const edges = aggregateEdges(graph, clustering);
    const crossing = graph.relations.filter((r) => clustering.clusterOf.get(r.from) !== clustering.clusterOf.get(r.to));
    expect(edges.reduce((n, e) => n + e.relations.length, 0)).toBe(crossing.length);
  });

  it("第 2 層的標籤是群內前 10%", () => {
    const biggest = clustering.clusters[0]!;
    expect(labelledInCluster(graph, biggest).size).toBe(Math.ceil(biggest.members.length * 0.1));
  });
});

describe("社群偵測", () => {
  it("沒有容器類型時也分成多群，沒有一群超過全部的一成五", () => {
    const { clusters } = clusterGraph(graph, LARGE_MODEL_NO_CONTAINER);
    expect(clusters.length).toBeGreaterThanOrEqual(LARGE_COUNTS.teams);
    for (const c of clusters) expect(c.members.length).toBeLessThan(graph.entities.length * 0.15);
  });
});

describe("容器分群", () => {
  it("部門與專案各自成群，群數＝容器數＋「其他」", () => {
    const { clusters } = clusterGraph(graph, LARGE_MODEL);
    expect(clusters.length).toBe(LARGE_COUNTS.teams + LARGE_COUNTS.projects + 1);
    expect(clusters.filter((c) => c.kind === "container").every((c) => c.anchor === c.id)).toBe(true);
  });

  it("有部門的人歸入部門（部門在知識模型中排在專案前）", () => {
    const { clusterOf } = clusterGraph(graph, LARGE_MODEL);
    for (const r of graph.relations.filter((r) => r.type === "member-of")) expect(clusterOf.get(r.from)).toMatch(/^team-/);
  });
});
