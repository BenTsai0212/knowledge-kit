import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "app",
  plugins: [react()],
  // 開發時把 /api/* 轉給 wrangler dev（worker/README.md）；Worker 依 ALLOWED_ORIGINS 放行 Vite 的 Origin
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
