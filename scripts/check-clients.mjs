// 客戶檢查：對 clients/ 底下的客戶依序執行設定檢查、target 測試（資料集與題庫的跨檔檢查、模型白名單）與 build（#77）。
// 用法：node scripts/check-clients.mjs [名稱]；不給名稱時檢查 clients/ 底下每個客戶，沒有客戶時略過。
// 以參數指定客戶，由這裡替子程序設定 KK_CLIENT，不需要在指令前加環境變數（#77 決定（給 PR 2））。
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveClientDir } from "./client-dir.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// clients/ 底下的資料夾名稱（排序）；clients/ 不存在時為空陣列。檔案（例如 README.md）不算客戶。
// 資料夾沒有 client.json 或名稱不合法時，由 resolveClientDir() 在檢查時明確失敗，不默默略過。
export function listClients(root = REPO_ROOT) {
  const dir = join(root, "clients");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// 每個客戶依序執行的步驟；outDir 是 build 的暫存資料夾，不覆蓋 dist/
export function clientSteps(name, outDir) {
  return [
    { label: "設定檢查", args: ["scripts/check-client.mjs", `clients/${name}/`] },
    {
      label: "target 測試",
      args: ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.clients.config.ts"],
    },
    { label: "build", args: ["node_modules/vite/bin/vite.js", "build", "--outDir", outDir, "--emptyOutDir"] },
  ];
}

function checkOne(name) {
  // 名稱不合法、沒有 client.json 時在這裡失敗
  resolveClientDir({ KK_CLIENT: name });
  const outDir = mkdtempSync(join(tmpdir(), `kk-build-${name}-`));
  try {
    for (const step of clientSteps(name, outDir)) {
      console.log(`\n== ${name}：${step.label} ==`);
      const result = spawnSync(process.execPath, step.args, {
        cwd: REPO_ROOT,
        stdio: "inherit",
        env: { ...process.env, KK_CLIENT: name },
      });
      if (result.status !== 0) throw new Error(`${name}：${step.label}失敗`);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const names = arg ? [arg] : listClients();
  if (names.length === 0) {
    console.log("clients/ 底下沒有客戶，略過");
    process.exit(0);
  }
  const failed = [];
  for (const name of names) {
    try {
      checkOne(name);
    } catch (err) {
      console.error(err.message);
      failed.push(name);
    }
  }
  if (failed.length > 0) {
    console.error(`\n客戶檢查失敗：${failed.join("、")}`);
    process.exit(1);
  }
  console.log(`\n客戶檢查通過：${names.join("、")}`);
}
