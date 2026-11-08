// multilingual-e5-small：以注入的假模型測試前綴、分批與相似度，不下載模型（#163）。
import { describe, expect, it } from "vitest";
import { ORT_WASM_FILES } from "../../../../scripts/ort-wasm.mjs";
import { modelFileUrl, E5_MODEL } from "./model-files";
import { BATCH_SIZE, createE5Provider, E5_PROVIDER_ID, type E5Deps } from "./multilingual-e5-small";
import { ORT_WASM, verifiedCache } from "./runtime";

const unit = (...xs: number[]) => {
  const norm = Math.hypot(...xs);
  return Float32Array.from(xs, (x) => x / norm);
};

// 假的模型：記錄每批收到的文字，回傳固定向量（前綴決定方向，方便確認 query／passage 有分開）
function fakeDeps() {
  const batches: string[][] = [];
  const deps: E5Deps = {
    loadFiles: async () => new Map(),
    createExtractor: async () => async (texts) => {
      batches.push(texts);
      return texts.map((t) => (t.startsWith("query: ") ? unit(1, 0) : unit(1, 1)));
    },
  };
  return { deps, batches };
}

describe("createE5Provider", () => {
  it("問題加 query: 前綴、段落加 passage: 前綴", async () => {
    const { deps, batches } = fakeDeps();
    const provider = await createE5Provider(deps);
    expect(provider.id).toBe(E5_PROVIDER_ID);
    await provider.embed(["年假幾天？"], "query");
    await provider.embed(["Annual leave is 7 days."], "passage");
    expect(batches).toEqual([["query: 年假幾天？"], ["passage: Annual leave is 7 days."]]);
  });

  it(`每批最多 ${BATCH_SIZE} 筆，順序不變；空陣列不呼叫模型`, async () => {
    const { deps, batches } = fakeDeps();
    const provider = await createE5Provider(deps);
    const texts = Array.from({ length: BATCH_SIZE * 2 + 3 }, (_, i) => `p${i}`);
    expect(await provider.embed(texts, "passage")).toHaveLength(texts.length);
    expect(batches.map((b) => b.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 3]);
    expect(batches.flat()).toEqual(texts.map((t) => `passage: ${t}`));
    expect(await provider.embed([], "query")).toEqual([]);
    expect(batches).toHaveLength(3);
  });

  it("相似度是 cosine，負值截到 0", async () => {
    const provider = await createE5Provider(fakeDeps().deps);
    expect(provider.similarity(unit(1, 0), unit(1, 0))).toBeCloseTo(1);
    expect(provider.similarity(unit(1, 0), unit(1, 1))).toBeCloseTo(Math.SQRT1_2);
    expect(provider.similarity(unit(1, 0), unit(-1, 0.1))).toBe(0);
  });

  it("模型檔載入或初始化失敗時，建立的 Promise 拋出", async () => {
    const failing: E5Deps = { ...fakeDeps().deps, loadFiles: async () => Promise.reject(new Error("下載失敗")) };
    await expect(createE5Provider(failing)).rejects.toThrow("下載失敗");
    const broken: E5Deps = { ...fakeDeps().deps, createExtractor: async () => Promise.reject(new Error("初始化失敗")) };
    await expect(createE5Provider(broken)).rejects.toThrow("初始化失敗");
  });
});

describe("verifiedCache", () => {
  it("只回應驗證過的檔案；鍵與 transformers.js 的遠端網址相同", async () => {
    const bytes = new TextEncoder().encode("{}") as Uint8Array<ArrayBuffer>;
    const cache = verifiedCache(E5_MODEL, new Map([["config.json", bytes]]));
    // transformers.js 的 remoteHost（https://huggingface.co/）＋ remotePathTemplate（{model}/resolve/{revision}/）＋檔名
    const response = await cache.match(`https://huggingface.co/${E5_MODEL.id}/resolve/${E5_MODEL.revision}/config.json`);
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(bytes);
    expect(await cache.match(modelFileUrl({ ...E5_MODEL, revision: "main" }, "config.json"))).toBeUndefined();
    expect(await cache.match(modelFileUrl(E5_MODEL, "generation_config.json"))).toBeUndefined();
  });
});

const raw = import.meta.glob<string>("../../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
const appSources = Object.entries(raw).filter(([path]) => !path.endsWith(".test.ts"));

describe("載入方式（ADR 0002）", () => {
  it("掃描範圍包含 app/src/ 的程式", () => {
    expect(appSources.map(([path]) => path)).toEqual(expect.arrayContaining(["./runtime.ts", "../../App.tsx"]));
  });

  it("@huggingface/transformers 只在 runtime.ts 以動態 import 載入", () => {
    const users = appSources.filter(([, text]) => text.includes("@huggingface/transformers")).map(([path]) => path);
    expect(users).toEqual(["./runtime.ts"]);
    const runtime = raw["./runtime.ts"];
    expect(runtime).toMatch(/await import\("@huggingface\/transformers"\)/);
    expect(runtime).not.toMatch(/from\s+["']@huggingface\/transformers["']/);
  });

  it("runtime.ts 也只以動態 import 載入", () => {
    const users = appSources.filter(([, text]) => /["']\.\/runtime["']|semantic\/runtime["']/.test(text));
    for (const [path, text] of users) expect(text, path).not.toMatch(/^import\s+(?!type\b)[^;]*["']\.\/runtime["']/m);
  });

  it("WASM 檔名與 build 時複製的檔案一致", () => {
    expect(Object.values(ORT_WASM).sort()).toEqual([...ORT_WASM_FILES].sort());
  });
});
