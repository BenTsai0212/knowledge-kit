import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.ts", "worker/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node",
    // 快取會沿用舊的 import.meta.glob 結果，新增的 migration 不會被載入（AGENTS.md 第 7 節）
    fsModuleCache: false,
  },
});
