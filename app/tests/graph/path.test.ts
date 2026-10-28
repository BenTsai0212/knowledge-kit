// 多跳路徑的權限：只經過看得到的實體與關係。以 oracle.ts 的可見圖、獨立實作的 BFS 算出最短距離比對。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { shortestPath } from "../../src/graph/path";
import { readGraph } from "../../src/graph/read";
import { datasetSample } from "../db/dataset-sample";
import { expectedVisible } from "../db/oracle";
import { seedSample, type Sample } from "../db/sample";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];

// oracle 的可見圖上，從 from 出發到各實體的最短距離（不設跳數上限；資料集最長 3 跳）
function distances(data: Sample, identityId: string | null, from: string): Map<string, number> {
  const visible = expectedVisible(access, data, identityId);
  const entities = new Set(visible.entities);
  const relations = data.relations.filter((r) => visible.relations.includes(r.id));
  const dist = new Map<string, number>();
  if (!entities.has(from)) return dist;
  dist.set(from, 0);
  for (const queue = [from]; queue.length > 0; ) {
    const current = queue.shift()!;
    for (const r of relations) {
      const other = r.from === current ? r.to : r.to === current ? r.from : null;
      if (other !== null && !dist.has(other)) {
        dist.set(other, dist.get(current)! + 1);
        queue.push(other);
      }
    }
  }
  return dist;
}

describe("多跳路徑（參考資料集）", () => {
  let db: Database;
  beforeAll(async () => {
    db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  });
  afterAll(async () => {
    await db.close();
  });

  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：每對實體的路徑與 oracle 的最短距離相同，且只經過看得到的關係", async (_name, id) => {
    const graph = await readGraph(db, id);
    const visible = expectedVisible(access, datasetSample, id);
    const relations = new Map(datasetSample.relations.map((r) => [r.id, r]));
    let found = 0;
    for (const a of datasetSample.entities) {
      const dist = distances(datasetSample, id, a.id);
      for (const b of datasetSample.entities) {
        const path = shortestPath(graph, a.id, b.id);
        const label = `${id}：${a.id} → ${b.id}`;
        if (!dist.has(b.id)) {
          expect(path, label).toBeNull();
          continue;
        }
        found++;
        expect(path, label).toHaveLength(dist.get(b.id)! + 1);
        expect(path![0], label).toEqual({ entity: a.id });
        expect(path!.at(-1)!.entity, label).toBe(b.id);
        for (let i = 1; i < path!.length; i++) {
          const { entity, relation } = path![i];
          const r = relations.get(relation!)!;
          expect(visible.relations, label).toContain(relation);
          expect([r.from, r.to].sort(), label).toEqual([path![i - 1].entity, entity].sort());
        }
      }
    }
    // 角色至少找得到一些路徑（防止以全部回 null 而通過）
    if (access.roles.some((r) => r.id === id)) expect(found).toBeGreaterThan(0);
  });

  it("主管找得到「黃建宏 → 長堤專案」；一般員工看不到長堤專案，找不到", async () => {
    expect(shortestPath(await readGraph(db, "manager"), "person-huang-jianhong", "project-longpier")).toEqual([
      { entity: "person-huang-jianhong" },
      { entity: "project-longpier", relation: "huang-works-on-longpier" },
    ]);
    expect(shortestPath(await readGraph(db, "staff"), "person-huang-jianhong", "project-longpier")).toBeNull();
  });
});

describe("多跳路徑：看不到中間節點時找不到", () => {
  // A —（公開）— B（只有機密出處）—（公開）— C：關係的出處公開，但中間的實體看不到
  const small: Sample = {
    docs: [
      { id: "doc-public", level: "public", project: null },
      { id: "doc-secret", level: "confidential", project: null },
    ],
    passages: [
      { id: "p-public", doc: "doc-public", level: "public", project: null },
      { id: "p-secret", doc: "doc-secret", level: "confidential", project: null },
    ],
    entities: [
      { id: "e-a", sources: ["p-public"] },
      { id: "e-b", sources: ["p-secret"] },
      { id: "e-c", sources: ["p-public"] },
    ],
    relations: [
      { id: "r-ab", from: "e-a", to: "e-b", sources: ["p-public"] },
      { id: "r-bc", from: "e-b", to: "e-c", sources: ["p-public"] },
    ],
  };
  let db: Database;
  beforeAll(async () => {
    db = await openDatabase(clientConfig, { seed: (pg) => seedSample(pg, small) });
  });
  afterAll(async () => {
    await db.close();
  });

  it("主管經由 B 找到 A → C；一般員工兩端都看得到，但找不到", async () => {
    expect(shortestPath(await readGraph(db, "manager"), "e-a", "e-c")?.map((s) => s.entity)).toEqual(["e-a", "e-b", "e-c"]);
    const staff = await readGraph(db, "staff");
    expect(staff.entities.map((e) => e.id).sort()).toEqual(["e-a", "e-c"]);
    expect(shortestPath(staff, "e-a", "e-c")).toBeNull();
    // 與 oracle 一致
    expect(distances(small, "staff", "e-a").has("e-c")).toBe(false);
  });
});
