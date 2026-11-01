import { defineConfig } from "vitest/config";
import { resolveClientDir } from "./scripts/client-dir.mjs";

// 客戶檢查（scripts/check-clients.mjs）用：@client 指向 KK_CLIENT 選定的客戶，只跑與客戶無關的 target 測試（#77）。
// target 測試也符合 *.test.ts，npm test（vitest.config.ts）會以參考情境 client/ 再跑一次。
export default defineConfig({
  resolve: { alias: { "@client": resolveClientDir() } },
  test: {
    include: ["app/**/*.target.test.ts", "worker/**/*.target.test.ts"],
    environment: "node",
    // 快取會沿用舊的 import.meta.glob 結果（AGENTS.md 第 7 節）
    fsModuleCache: false,
  },
});
