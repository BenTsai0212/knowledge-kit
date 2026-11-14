// Playwright（#66，ADR 0004；說明見 docs/testing.md）：對 npm run build 後的預覽頁執行，只用 Chromium。
// 每個頁面都在瀏覽器內建一個 PGlite，平行執行容易逾時，所以 workers 固定為 1。
import { defineConfig, devices } from "@playwright/test";

// 根目錄的 tsconfig 不含 Node 的型別，這裡只需要 CI、VITE_ONLINE_DEMO 與 KK_README_SHOTS 三個環境變數
declare const process: { env: Record<string, string | undefined> };
const ci = process.env.CI !== undefined && process.env.CI !== "";
// 線上 demo 的 build（VITE_ONLINE_DEMO=1，#100）只執行 demo.spec.ts，其他 build 不執行它；build 與測試用同一個設定
const demo = process.env.VITE_ONLINE_DEMO === "1";
// README 的截圖（#369，docs/testing.md「README 的截圖」）：KK_README_SHOTS=1 時只執行 readme-shots.spec.ts，其他時候不執行它
const readmeShots = process.env.KK_README_SHOTS === "1";
const scope = demo
  ? { testMatch: "demo.spec.ts" }
  : readmeShots
    ? { testMatch: "readme-shots.spec.ts" }
    : { testIgnore: ["demo.spec.ts", "readme-shots.spec.ts"] };

export default defineConfig({
  testDir: "e2e",
  ...scope,
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // skip-reporter：列出略過的測試與原因，參考情境有略過時失敗（#77）
  reporter: ci
    ? [["list"], ["./e2e/support/skip-reporter.ts"], ["html", { open: "never" }]]
    : [["list"], ["./e2e/support/skip-reporter.ts"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // 先 npm run build（客戶用同一個 KK_CLIENT build，測試讀的客戶資料見 e2e/support/client.ts）；預覽頁沒有 /api/*，/api/ask 由測試以 page.route 回應
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !ci,
  },
});
