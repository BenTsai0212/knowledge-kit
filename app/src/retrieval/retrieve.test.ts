import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import { seedDataset } from "../dataset/seed";
import { openDatabase, type Database } from "../db/database";
import { keywordHashProvider } from "./keyword-hash";
import { createRetriever, openRetriever } from "./retrieve";
import type { VectorProvider } from "./types";

let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

describe("retrieve", () => {
  it("依 client.json 的設定回傳前 K 名，帶出段落的文件與語言", async () => {
    const results = await openRetriever(db, clientConfig.client.retrieval).retrieve("staff", "到職滿一年有幾天年假？");
    expect(results.length).toBeLessThanOrEqual(clientConfig.client.retrieval.topK);
    expect(results[0]).toMatchObject({
      id: "employee-handbook-zh-03",
      documentId: "employee-handbook-zh",
      documentTitle: Object.values(dataset.documents).find((d) => d.id === "employee-handbook-zh")!.title,
      language: "zh-TW",
    });
    expect(results[0].content).toContain("年假");
  });

  it("依分數由高到低排序，低於門檻的段落不回傳", async () => {
    const results = await createRetriever(db, keywordHashProvider, { topK: 20, minScore: 0.1 }).retrieve("manager", "年假");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.score >= 0.1)).toBe(true);
    expect(results.map((r) => r.score)).toEqual(results.map((r) => r.score).sort((a, b) => b - a));
  });

  it("topK 限制回傳數量", async () => {
    const results = await createRetriever(db, keywordHashProvider, { topK: 2, minScore: 0 }).retrieve("manager", "專案");
    expect(results).toHaveLength(2);
  });

  it("沒有共同詞時回傳空陣列", async () => {
    expect(await openRetriever(db, clientConfig.client.retrieval).retrieve("manager", "xyzzy")).toEqual([]);
  });

  it("沒有身分或身分不存在時查不到段落", async () => {
    const retriever = openRetriever(db, clientConfig.client.retrieval);
    expect(await retriever.retrieve(null, "年假")).toEqual([]);
    expect(await retriever.retrieve("nobody", "年假")).toEqual([]);
  });

  it("段落向量只計算一次，之後只轉換問題", async () => {
    const batches: number[] = [];
    const counting: VectorProvider = {
      ...keywordHashProvider,
      embed: (texts) => (batches.push(texts.length), keywordHashProvider.embed(texts)),
    };
    const retriever = createRetriever(db, counting, { topK: 5, minScore: 0 });
    const visible = async (id: string) => db.withIdentity(id, async (tx) => (await tx.query("SELECT id FROM kk.passages")).rows.length);
    await retriever.retrieve("guest", "年假");
    await retriever.retrieve("guest", "部門");
    // 主管多看到的段落才需要計算
    await retriever.retrieve("manager", "年假");
    expect(batches).toEqual([1 + (await visible("guest")), 1, 1 + (await visible("manager")) - (await visible("guest"))]);
  });
});
