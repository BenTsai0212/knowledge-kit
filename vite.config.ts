import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveClientDir } from "./scripts/client-dir.mjs";

export default defineConfig({
  root: "app",
  plugins: [react()],
  // @client 指向選定的客戶（KK_CLIENT，未設定時 client/）；資料夾不存在時在這裡失敗（docs/client-config.md「多客戶與切換」）
  resolve: { alias: { "@client": resolveClientDir() } },
  // PGlite 的 wasm 與資料檔以相對於模組的網址載入，預先打包會改變路徑（PGlite 官方文件的建議）
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  // 開發時把 /api/* 轉給 wrangler dev（worker/README.md）；Worker 依 ALLOWED_ORIGINS 放行 Vite 的 Origin
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
