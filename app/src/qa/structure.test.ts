// 結構測試：問答模組只透過 retrieve() 取得段落，不直接查詢資料庫、不匯入具體的 VectorProvider（#26）。
import { describe, expect, it } from "vitest";

const raw = import.meta.glob<string>("./*.ts", { query: "?raw", import: "default", eager: true });
const sources = Object.entries(raw).filter(([path]) => !path.endsWith(".test.ts"));

const FORBIDDEN = [
  // 資料層
  /from\s+["'][^"']*\/db\//,
  /\bwithIdentity\b/,
  /\.(query|exec)\s*\(/,
  /\bkk\./,
  // retrieval/ 中 retrieve.ts、types.ts 以外的檔（具體的 VectorProvider 與選擇實作的地方）
  /from\s+["'][^"']*retrieval\/(?!retrieve["']|types["'])[^"']+["']/,
];

const violations = (text: string) => FORBIDDEN.filter((re) => re.test(text)).map(String);

describe("app/src/qa/ 的結構", () => {
  it("規則能抓到直接查詢資料庫或匯入具體實作的寫法", () => {
    for (const bad of [
      'import { openDatabase } from "../db/database";',
      "await db.withIdentity(id, fn);",
      'await tx.query("SELECT 1");',
      "SELECT * FROM kk.passages",
      'import { keywordHashProvider } from "../retrieval/keyword-hash";',
      'import { createProvider } from "../retrieval/providers";',
    ]) {
      expect(violations(bad), bad).not.toEqual([]);
    }
    expect(violations('import type { Retriever } from "../retrieval/retrieve";')).toEqual([]);
    expect(violations('import type { VectorProvider } from "../retrieval/types";')).toEqual([]);
  });

  it("掃描範圍包含 qa/ 的程式", () => {
    expect(sources.map(([path]) => path)).toEqual(expect.arrayContaining(["./answer.ts", "./prompt.ts", "./citations.ts"]));
  });

  it("qa/ 不直接查詢資料庫、不匯入具體的 VectorProvider", () => {
    expect(sources.flatMap(([path, text]) => violations(text).map((v) => `${path} ${v}`))).toEqual([]);
  });
});
