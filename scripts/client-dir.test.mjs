import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REFERENCE_CLIENT_DIR, resolveClientDir } from "./client-dir.mjs";

const root = mkdtempSync(join(tmpdir(), "client-dir-"));
mkdirSync(join(root, "clients", "demo"), { recursive: true });
writeFileSync(join(root, "clients", "demo", "client.json"), "{}");
mkdirSync(join(root, "clients", "empty"), { recursive: true });

describe("resolveClientDir", () => {
  it("未設定或空字串時用 client/", () => {
    expect(resolveClientDir({}, root)).toBe(join(root, "client"));
    expect(resolveClientDir({ KK_CLIENT: "" }, root)).toBe(join(root, "client"));
  });

  it("沒有給 root 時以 repo 根目錄解析", () => {
    expect(REFERENCE_CLIENT_DIR).toBe(join(fileURLToPath(new URL("..", import.meta.url)), "client"));
    expect(resolveClientDir({})).toBe(REFERENCE_CLIENT_DIR);
  });

  it("KK_CLIENT=<名稱> 對應 clients/<名稱>/", () => {
    expect(resolveClientDir({ KK_CLIENT: "demo" }, root)).toBe(join(root, "clients", "demo"));
  });

  it("資料夾不存在或沒有 client.json 時明確失敗", () => {
    expect(() => resolveClientDir({ KK_CLIENT: "nope" }, root)).toThrow("KK_CLIENT=nope：找不到 clients/nope/client.json");
    expect(() => resolveClientDir({ KK_CLIENT: "empty" }, root)).toThrow("KK_CLIENT=empty：找不到 clients/empty/client.json");
  });

  it("vite.config.ts（dev、build）在 KK_CLIENT 指向不存在的資料夾時失敗", async () => {
    const saved = process.env.KK_CLIENT;
    process.env.KK_CLIENT = "nope";
    try {
      await expect(import("../vite.config.ts")).rejects.toThrow("KK_CLIENT=nope：找不到 clients/nope/client.json");
    } finally {
      if (saved === undefined) delete process.env.KK_CLIENT;
      else process.env.KK_CLIENT = saved;
    }
  });

  it("名稱不合法時失敗（不能跳出 clients/）", () => {
    for (const name of ["../client", "demo/x", "Demo", "-demo", ".."]) {
      expect(() => resolveClientDir({ KK_CLIENT: name }, root), name).toThrow("名稱只能用");
    }
  });
});
