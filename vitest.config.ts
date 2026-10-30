import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.ts", "worker/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node",
    // 快取會沿用舊的 import.meta.glob 結果，新增的 migration 不會被載入（AGENTS.md 第 7 節）
    fsModuleCache: false,
    // Vitest 預設把 CSS 換成空字串（?raw 也一樣）；app.css 由 ui/theme.test.ts 檢查，需要原文
    css: { include: [/app\/src\/ui\/app\.css/] },
  },
});
