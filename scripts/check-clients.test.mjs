import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientSteps, listClients } from "./check-clients.mjs";

describe("listClients", () => {
  it("clients/ 不存在時為空陣列", () => {
    expect(listClients(mkdtempSync(join(tmpdir(), "check-clients-")))).toEqual([]);
  });

  it("只列出資料夾並排序，README.md 等檔案不算客戶", () => {
    const root = mkdtempSync(join(tmpdir(), "check-clients-"));
    for (const name of ["zeta", "alpha", "no-config"]) mkdirSync(join(root, "clients", name), { recursive: true });
    writeFileSync(join(root, "clients", "README.md"), "");
    // 沒有 client.json 的資料夾也列出，檢查時由 resolveClientDir() 失敗
    expect(listClients(root)).toEqual(["alpha", "no-config", "zeta"]);
  });
});

describe("clientSteps", () => {
  it("依序執行設定檢查、target 測試、build，build 輸出到暫存資料夾", () => {
    const steps = clientSteps("demo", "/tmp/out");
    expect(steps.map((s) => s.label)).toEqual(["設定檢查", "target 測試", "build"]);
    expect(steps[0].args).toEqual(["scripts/check-client.mjs", "clients/demo/"]);
    expect(steps[1].args).toContain("vitest.clients.config.ts");
    expect(steps[2].args).toEqual(expect.arrayContaining(["build", "--outDir", "/tmp/out"]));
  });
});
