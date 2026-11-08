import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import { evalQuestions } from "../evals/load";
import { seedDataset } from "../dataset/seed";
import { openDatabase, type Database } from "../db/database";
import { cosine, embedText, keywordHashProvider } from "./keyword-hash";
import { createProvider, PROVIDERS } from "./providers";
import { createRetriever, openRetriever } from "./retrieve";
import type { EmbedKind, VectorProvider } from "./types";

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

  it("個別呼叫的選項：限制語言、排除文件、改變筆數與門檻；帶出文件日期", async () => {
    const retriever = createRetriever(db, keywordHashProvider, { topK: 20, minScore: 0 });
    const all = await retriever.retrieve("manager", "專案");
    expect(new Set(all.map((r) => r.language)).size).toBeGreaterThan(1);
    const en = await retriever.retrieve("manager", "專案", { language: "en" });
    expect(en.length).toBeGreaterThan(0);
    expect(en.every((r) => r.language === "en")).toBe(true);
    const excluded = all[0].documentId;
    expect((await retriever.retrieve("manager", "專案", { excludeDocument: excluded })).some((r) => r.documentId === excluded)).toBe(false);
    expect(await retriever.retrieve("manager", "專案", { topK: 1 })).toEqual(all.slice(0, 1));
    expect((await retriever.retrieve("manager", "專案", { minScore: 0.2 })).every((r) => r.score >= 0.2)).toBe(true);
    const handbook = Object.values(dataset.documents).find((d) => d.id === all[0].documentId)!;
    expect(all[0].documentDate).toBe(handbook.date ?? null);
  });

  it("沒有共同詞時回傳空陣列", async () => {
    expect(await openRetriever(db, clientConfig.client.retrieval).retrieve("manager", "xyzzy")).toEqual([]);
  });

  it("沒有身分或身分不存在時查不到段落", async () => {
    const retriever = openRetriever(db, clientConfig.client.retrieval);
    expect(await retriever.retrieve(null, "年假")).toEqual([]);
    expect(await retriever.retrieve("nobody", "年假")).toEqual([]);
  });

  it("問題以 query、段落以 passage 轉換；段落向量只計算一次，之後只轉換問題", async () => {
    const calls: [EmbedKind, number][] = [];
    const counting: VectorProvider = {
      ...keywordHashProvider,
      embed: (texts, kind) => (calls.push([kind, texts.length]), keywordHashProvider.embed(texts, kind)),
    };
    const retriever = createRetriever(db, counting, { topK: 5, minScore: 0 });
    const visible = async (id: string) => db.withIdentity(id, async (tx) => (await tx.query("SELECT id FROM kk.passages")).rows.length);
    await retriever.retrieve("guest", "年假");
    await retriever.retrieve("guest", "部門");
    // 主管多看到的段落才需要計算
    await retriever.retrieve("manager", "年假");
    expect(calls).toEqual([
      ["query", 1],
      ["passage", await visible("guest")],
      ["query", 1],
      ["query", 1],
      ["passage", (await visible("manager")) - (await visible("guest"))],
    ]);
  });

  it("provider 可以是 Promise：第一次檢索時才等待，準備失敗時由 retrieve() 拋出", async () => {
    let resolve!: (p: VectorProvider) => void;
    const retriever = createRetriever(db, new Promise<VectorProvider>((r) => (resolve = r)), { topK: 5, minScore: 0 });
    const pending = retriever.retrieve("staff", "年假");
    resolve(keywordHashProvider);
    expect(await pending).toEqual(await createRetriever(db, keywordHashProvider, { topK: 5, minScore: 0 }).retrieve("staff", "年假"));

    const failing = createRetriever(db, Promise.reject(new Error("模型下載失敗")), { topK: 5, minScore: 0 });
    await expect(failing.retrieve("staff", "年假")).rejects.toThrow("模型下載失敗");
  });

  it("參數也可以是 Promise：檢索時才讀取（降級後改用 keyword-hash 的 minScore）", async () => {
    let resolve!: (o: { topK: number; minScore: number }) => void;
    const retriever = createRetriever(db, keywordHashProvider, new Promise((r) => (resolve = r)));
    const pending = retriever.retrieve("staff", "年假");
    resolve({ topK: 2, minScore: 0 });
    expect(await pending).toEqual(await createRetriever(db, keywordHashProvider, { topK: 2, minScore: 0 }).retrieve("staff", "年假"));
  });

  it("語意模型準備失敗：以 keyword-hash 與它的 minScore 檢索，結果與 keyword-hash 的客戶相同", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e5 = { ...clientConfig.client.retrieval, provider: "multilingual-e5-small" as const, minScore: 0.7 };
    const failing = createProvider(e5, { ...PROVIDERS, "multilingual-e5-small": () => Promise.reject(new Error("模型初始化失敗")) });
    const question = "到職滿一年有幾天年假？";
    const results = await openRetriever(db, e5, failing).retrieve("staff", question);
    expect(results.length).toBeGreaterThan(0);
    expect(results).toEqual(await openRetriever(db, clientConfig.client.retrieval).retrieve("staff", question));
    warn.mockRestore();
  });

  it("keyword-hash：每題的分數與排序和直接以 embedText、cosine 計分相同", async () => {
    const passages = await db.withIdentity("manager", async (tx) => (await tx.query<{ id: string; content: string }>("SELECT id, content FROM kk.passages")).rows);
    const retriever = createRetriever(db, keywordHashProvider, { topK: passages.length, minScore: 0 });
    for (const { question } of evalQuestions.questions) {
      const q = embedText(question);
      const expected = passages
        .map((p) => ({ id: p.id, score: cosine(q, embedText(p.content)) }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      expect((await retriever.retrieve("manager", question)).map(({ id, score }) => ({ id, score }))).toEqual(expected);
    }
  });
});
