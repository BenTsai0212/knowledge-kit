// 測試用的大型圖（#254）：虛構、固定種子，240 個實體，用來驗證大量節點時的門檻與分群。
// 只在測試中產生 Graph 物件，不放進參考情境 client/（參考情境維持 14 個實體）。名稱一律是編號，沒有真實的人名或組織。
import type { ClusterModel } from "../../src/graph/clusters";
import type { Graph, GraphEntity, GraphRelation } from "../../src/graph/read";

export const LARGE_COUNTS = { teams: 8, projects: 6, people: 222, loners: 4 } as const;

// 參考情境的類型；team、project 是容器
export const LARGE_MODEL: ClusterModel = {
  entityTypes: [
    { id: "person", container: false },
    { id: "team", container: true },
    { id: "project", container: true },
  ],
};

// 同一份資料、沒有容器類型時（以社群偵測分群）
export const LARGE_MODEL_NO_CONTAINER: ClusterModel = { entityTypes: LARGE_MODEL.entityTypes.map(({ id }) => ({ id })) };

// mulberry32：固定種子的亂數，每次產生相同的圖
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(3, "0");
const entity = (id: string, type: string, name: string): GraphEntity => ({ id, type, name, names: { "zh-TW": name, en: name }, sources: [] });

export function largeGraph(seed = 254): Graph {
  const rnd = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]!;
  const teams = Array.from({ length: LARGE_COUNTS.teams }, (_, i) => entity(`team-${pad(i + 1)}`, "team", `Team ${pad(i + 1)}`));
  const projects = Array.from({ length: LARGE_COUNTS.projects }, (_, i) => entity(`project-${pad(i + 1)}`, "project", `Project ${pad(i + 1)}`));
  const people = Array.from({ length: LARGE_COUNTS.people }, (_, i) => entity(`person-${pad(i + 1)}`, "person", `Person ${pad(i + 1)}`));
  // 沒有任何關係的實體（放進「其他」）
  const loners = Array.from({ length: LARGE_COUNTS.loners }, (_, i) => entity(`person-x${pad(i + 1)}`, "person", `Person X${pad(i + 1)}`));

  const relations: GraphRelation[] = [];
  const add = (type: string, from: string, to: string) => {
    if (relations.some((r) => r.type === type && r.from === from && r.to === to)) return;
    relations.push({ id: `rel-${pad(relations.length + 1)}`, type, from, to, sources: [] });
  };
  people.forEach((p, i) => {
    // 少數人沒有部門，只連到專案
    if (rnd() < 0.94) add("member-of", p.id, pick(teams).id);
    add("works-on", p.id, pick(projects).id);
    if (rnd() < 0.4) add("works-on", p.id, pick(projects).id);
    if (i < LARGE_COUNTS.teams) add("leads", p.id, teams[i]!.id);
  });
  for (const t of teams) {
    add("works-on", t.id, pick(projects).id);
    if (rnd() < 0.5) add("works-on", t.id, pick(projects).id);
  }
  return { entities: [...teams, ...projects, ...people, ...loners], relations };
}

// 打亂實體與關係的順序（驗證分群與順序無關）
export function shuffled(graph: Graph, seed: number): Graph {
  const rnd = random(seed);
  const shuffle = <T>(list: readonly T[]) =>
    list
      .map((x) => ({ x, k: rnd() }))
      .sort((a, b) => a.k - b.k)
      .map(({ x }) => x);
  return { entities: shuffle(graph.entities), relations: shuffle(graph.relations) };
}
