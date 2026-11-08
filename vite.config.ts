import { defaultClientConditions, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveClientDir } from "./scripts/client-dir.mjs";
import { ortWasmPlugin } from "./scripts/ort-wasm.mjs";

// @client 指向選定的客戶（KK_CLIENT，未設定時 client/）；資料夾不存在時在這裡失敗（docs/client-config.md「多客戶與切換」）
const clientDir = resolveClientDir();

export default defineConfig({
  root: "app",
  // 語意向量 provider 的 WASM 自己提供（scripts/ort-wasm.mjs，docs/retrieval.md「語意向量」）
  plugins: [react(), ortWasmPlugin(clientDir)],
  resolve: {
    alias: { "@client": clientDir },
    // onnxruntime-web 改用不內含 WASM 的版本：預設版本會把超過單檔上限的 asyncify WASM 打包進 dist/
    conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions],
  },
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
