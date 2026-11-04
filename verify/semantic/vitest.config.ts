import { defineConfig } from "vitest/config";
import { REFERENCE_CLIENT_DIR } from "../../scripts/client-dir.mjs";

// #126 verify 分支專用：量測與換 provider 的滲漏測試（npm test 不包含）
export default defineConfig({
  resolve: { alias: { "@client": REFERENCE_CLIENT_DIR } },
  test: {
    root: new URL("../../", import.meta.url).pathname,
    include: ["verify/semantic/**/*.verify.test.ts"],
    environment: "node",
    fsModuleCache: false,
  },
});
