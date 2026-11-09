// 結構測試：VectorProvider 接口存在，且決定使用哪個實作的地方只有 providers.ts（#22）。
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import clientSchema from "../../../client/schema/client.schema.json";
import { clientConfig } from "../client/load";
import type { ProviderId } from "../client/types";
import { createProvider, PROVIDERS, RETRIEVAL_DEFAULTS, type ProgressListener, type ProviderFactory } from "./providers";
import { loadVerifiedFiles, type DownloadDeps } from "./semantic/download";
import { E5_MODEL, modelFileUrl } from "./semantic/model-files";
import { createE5Provider, type E5Deps } from "./semantic/multilingual-e5-small";

// 假的語意模型：依文字的雜湊產生固定的單位向量（分量有正有負，cosine 可能為負），不下載模型
const fakeE5Deps: E5Deps = {
  loadFiles: async () => new Map(),
  createExtractor: async () => async (texts) =>
    texts.map((text) => {
      let h = 2166136261;
      const v = Float32Array.from({ length: 8 }, (_, i) => {
        for (const c of `${text}#${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return (h >>> 0) / 2 ** 31 - 1;
      });
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    }),
};
// 測試用的 PROVIDERS：語意模型改用假的模型，其他照舊
const TESTABLE: Record<ProviderId, ProviderFactory> = { ...PROVIDERS, "multilingual-e5-small": () => createE5Provider(fakeE5Deps) };

// 空的 CacheStorage：每次都要下載
const emptyCaches: DownloadDeps["caches"] = {
  open: async () => ({ match: async () => undefined, put: async () => {}, delete: async () => true }) as unknown as Cache,
};
const sizeOf = (url: string) => E5_MODEL.files.find((f) => modelFileUrl(E5_MODEL, f.path) === url)!.bytes;

const raw = import.meta.glob<string>("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
// Vite 以相對於本檔的路徑為鍵（同資料夾為 ./），統一成相對於 app/src/ 的路徑
const sources = Object.fromEntries(
  Object.entries(raw).map(([path, text]) => [path.replace(/^\.\//, "retrieval/").replace(/^\.\.\//, ""), text]),
);
const appSources = Object.entries(sources).filter(([path]) => !path.endsWith(".test.ts"));
const SELECTOR = "retrieval/providers.ts";

// 匯入具體實作（retrieval/ 中 types.ts、providers.ts、retrieve.ts 以外的檔）或讀取 retrieval.provider
const SELECTING = [/from\s+["'][^"']*retrieval\/(?!types["']|providers["']|retrieve["'])[^"']+["']/, /from\s+["']\.\/keyword-hash["']/, /\.provider\b/];

const selecting = (text: string) => SELECTING.some((re) => re.test(text));

describe("VectorProvider", () => {
  it("接口定義在 retrieval/types.ts", () => {
    expect(sources["retrieval/types.ts"]).toMatch(/export interface VectorProvider<V = unknown> \{/);
  });

  it("規則能抓到選擇實作的寫法", () => {
    expect(selecting('import { keywordHashProvider } from "../retrieval/keyword-hash";')).toBe(true);
    expect(selecting('import { keywordHashProvider } from "./keyword-hash";')).toBe(true);
    expect(selecting("const p = config.client.retrieval.provider;")).toBe(true);
    expect(selecting('import type { VectorProvider } from "../retrieval/types";')).toBe(false);
    expect(selecting('import { createProvider } from "../retrieval/providers";')).toBe(false);
    expect(selecting('import { openRetriever } from "../retrieval/retrieve";')).toBe(false);
  });

  it("掃描範圍包含 app/src/ 的程式", () => {
    expect(appSources.map(([path]) => path)).toEqual(expect.arrayContaining([SELECTOR, "client/load.ts", "db/database.ts"]));
  });

  it("只有 providers.ts 選擇實作", () => {
    expect(appSources.filter(([, text]) => selecting(text)).map(([path]) => path)).toEqual([SELECTOR]);
  });

  it("PROVIDERS 的鍵與 Schema 的列舉一致，且與各實作的 id 相同", async () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([...clientSchema.properties.retrieval.properties.provider.enum].sort());
    for (const [key, factory] of Object.entries(TESTABLE)) expect((await factory()).id).toBe(key);
  });

  it("每個實作：一筆文字一個向量；相似度在 0～1（含無關與不同語言的文字）", async () => {
    const texts = ["到職滿一年有幾天年假？", "Annual leave is 7 days after one year.", "青翼桌預計第三季上市。", "xyzzy", ""];
    for (const factory of Object.values(TESTABLE)) {
      const provider = await factory();
      const queries = await provider.embed(texts, "query");
      const passages = await provider.embed(texts, "passage");
      expect([queries.length, passages.length]).toEqual([texts.length, texts.length]);
      for (const a of queries)
        for (const b of passages) {
          const score = provider.similarity(a, b);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }
    }
  });

  it("依 client.json 建立實作，未登記的值在呼叫時就拋錯", async () => {
    const { retrieval } = clientConfig.client;
    expect(await createProvider(retrieval)).toEqual({
      provider: expect.objectContaining({ id: "keyword-hash" }),
      options: { topK: retrieval.topK, minScore: retrieval.minScore },
      fallback: null,
    });
    expect(() => createProvider({ ...retrieval, provider: "pgvector" as never })).toThrow("未登記的 VectorProvider：pgvector");
    expect(() => createProvider({ ...retrieval, provider: "toString" as never })).toThrow("未登記的 VectorProvider");
  });
});

describe("降級到 keyword-hash（#163）", () => {
  const E5 = { provider: "multilingual-e5-small", topK: 3, minScore: 0.75 } as const;
  const e5With = (deps: Partial<E5Deps>) => ({ ...TESTABLE, "multilingual-e5-small": () => createE5Provider({ ...fakeE5Deps, ...deps }) });
  // 以實際的下載與驗證（download.ts）處理假的回應
  const downloading = (fetch: DownloadDeps["fetch"]) => e5With({ loadFiles: (model) => loadVerifiedFiles(model, { fetch, caches: emptyCaches }) });

  let warn: MockInstance;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("準備成功：不降級，使用 client.json 的參數", async () => {
    const active = await createProvider(E5, TESTABLE);
    expect([active.provider.id, active.options, active.fallback]).toEqual(["multilingual-e5-small", { topK: 3, minScore: 0.75 }, null]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["HTTP 錯誤", "download", async () => new Response(null, { status: 503 })],
    ["連不上", "download", async () => Promise.reject(new TypeError("Failed to fetch"))],
    ["雜湊不符", "integrity", async (url: string) => new Response(new Uint8Array(sizeOf(url)))],
    ["大小不符", "integrity", async () => new Response(new Uint8Array(3))],
  ] as const)("%s：改用 keyword-hash（原因 %s），minScore 改用 keyword-hash 的預設值，topK 不變", async (_, reason, fetch) => {
    const active = await createProvider(E5, downloading(fetch));
    expect(active.provider.id).toBe("keyword-hash");
    expect(active.options).toEqual({ topK: 3, minScore: RETRIEVAL_DEFAULTS["keyword-hash"].minScore });
    expect(active.fallback).toEqual({ from: "multilingual-e5-small", reason });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("初始化失敗、載入模組失敗或同步拋錯：原因是 init", async () => {
    const failures = [
      e5With({ createExtractor: async () => Promise.reject(new Error("WebAssembly 無法啟動")) }),
      { ...TESTABLE, "multilingual-e5-small": () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")) },
      {
        ...TESTABLE,
        "multilingual-e5-small": () => {
          throw new Error("同步拋錯");
        },
      },
    ];
    for (const factories of failures) expect((await createProvider(E5, factories)).fallback).toEqual({ from: "multilingual-e5-small", reason: "init" });
  });

  it("下載進度經 createProvider 交給 onProgress（#171）", async () => {
    const reports: { loaded: number; total: number }[] = [];
    const unavailable = async () => new Response(null, { status: 503 });
    const loadFiles: E5Deps["loadFiles"] = (model, listener) => loadVerifiedFiles(model, { fetch: unavailable, caches: emptyCaches }, listener);
    const factories = { ...TESTABLE, "multilingual-e5-small": (onProgress?: ProgressListener) => createE5Provider({ ...fakeE5Deps, loadFiles }, onProgress) };
    const total = E5_MODEL.files.reduce((sum, f) => sum + f.bytes, 0);
    expect((await createProvider(E5, factories, (p) => reports.push(p))).fallback?.reason).toBe("download");
    expect(reports).toEqual([{ loaded: 0, total }]);
  });

  it("keyword-hash 不回報進度", async () => {
    const reports: unknown[] = [];
    await createProvider(clientConfig.client.retrieval, TESTABLE, (p) => reports.push(p));
    expect(reports).toEqual([]);
  });

  it("keyword-hash 本身失敗時不降級，照常拋出", async () => {
    const broken = { ...TESTABLE, "keyword-hash": () => Promise.reject(new Error("壞掉")) };
    await expect(createProvider(clientConfig.client.retrieval, broken)).rejects.toThrow("壞掉");
  });
});
