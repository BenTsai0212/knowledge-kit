import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "app",
  plugins: [react()],
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
