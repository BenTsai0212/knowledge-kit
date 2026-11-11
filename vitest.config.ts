import { defineConfig } from "vitest/config";
import { REFERENCE_CLIENT_DIR } from "./scripts/client-dir.mjs";

export default defineConfig({
  // npm test 永遠以參考情境 client/ 執行，不看 KK_CLIENT（#77 決定 4）
  resolve: { alias: { "@client": REFERENCE_CLIENT_DIR } },
  test: {
    include: ["app/**/*.test.ts", "worker/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node",
    // 快取會沿用舊的 import.meta.glob 結果，新增的 migration 不會被載入（AGENTS.md 第 7 節）
    fsModuleCache: false,
    // Vitest 預設把 CSS 換成空字串（?raw 也一樣）；app.css 由 ui/theme.test.ts 檢查、動態參考檔由 ui/motion-reference.test.ts 比對，需要原文
    css: { include: [/app\/src\/ui\/app\.css/, /docs\/design\/motion-reference\.css/] },
  },
});
