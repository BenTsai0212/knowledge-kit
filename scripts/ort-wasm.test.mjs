import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REFERENCE_CLIENT_DIR } from "./client-dir.mjs";
import { copyOrtWasm, MAX_STATIC_FILE_BYTES, ORT_WASM_DIR, ORT_WASM_FILES, usesSemanticProvider } from "./ort-wasm.mjs";

const temp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

function clientWith(retrieval) {
  const dir = temp("ort-client-");
  writeFileSync(join(dir, "client.json"), JSON.stringify(retrieval === undefined ? {} : { retrieval }));
  return dir;
}

describe("usesSemanticProvider", () => {
  it("只有選用語意向量 provider 的客戶要複製 WASM", () => {
    expect(usesSemanticProvider(clientWith({ provider: "multilingual-e5-small" }))).toBe(true);
    expect(usesSemanticProvider(clientWith({ provider: "keyword-hash" }))).toBe(false);
    expect(usesSemanticProvider(clientWith(undefined))).toBe(false);
  });

  it("參考情境不複製（keyword-hash 的 dist/ 不含 WASM）", () => {
    expect(usesSemanticProvider(REFERENCE_CLIENT_DIR)).toBe(false);
  });
});

describe("copyOrtWasm", () => {
  it("安裝的 WASM 都在單檔上限內，複製到 ort/", () => {
    const out = temp("ort-out-");
    copyOrtWasm(out);
    expect(readdirSync(join(out, ORT_WASM_DIR)).sort()).toEqual([...ORT_WASM_FILES].sort());
    for (const name of ORT_WASM_FILES) expect(statSync(join(out, ORT_WASM_DIR, name)).size).toBeLessThanOrEqual(MAX_STATIC_FILE_BYTES);
  });

  it("超過 25 MiB 的檔案讓 build 失敗", () => {
    const source = temp("ort-src-");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, ORT_WASM_FILES[0]), Buffer.alloc(MAX_STATIC_FILE_BYTES + 1));
    writeFileSync(join(source, ORT_WASM_FILES[1]), "");
    const out = temp("ort-out-");
    expect(MAX_STATIC_FILE_BYTES).toBe(26_214_400);
    expect(() => copyOrtWasm(out, source)).toThrow(`超過靜態檔單檔上限 26214400 bytes`);
    expect(existsSync(join(out, ORT_WASM_DIR, ORT_WASM_FILES[0]))).toBe(false);
  });
});
