// 結構測試：VectorProvider 接口存在，且決定使用哪個實作的地方只有 providers.ts（#22）。
import { describe, expect, it } from "vitest";
import clientSchema from "../../../client/schema/client.schema.json";
import { clientConfig } from "../client/load";
import { createProvider, PROVIDERS } from "./providers";

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

  it("PROVIDERS 的鍵與 Schema 的列舉一致，且與各實作的 id 相同", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([...clientSchema.properties.retrieval.properties.provider.enum].sort());
    for (const [key, provider] of Object.entries(PROVIDERS)) expect(provider.id).toBe(key);
  });

  it("依 client.json 建立實作，未登記的值拋錯", () => {
    expect(createProvider(clientConfig.client.retrieval).id).toBe("keyword-hash");
    expect(() => createProvider({ provider: "pgvector" as never })).toThrow("未登記的 VectorProvider：pgvector");
    expect(() => createProvider({ provider: "toString" as never })).toThrow("未登記的 VectorProvider");
  });
});
