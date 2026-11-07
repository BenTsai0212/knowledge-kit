// 語意向量 provider 用的 ONNX Runtime WASM：自己提供，不從 jsDelivr 載入（ADR 0006、#163）。
// build 時只在客戶選用語意向量 provider 時複製到 dist/ort/；npm run dev 一律提供，供開發與量測。
// 檔名與 app/src/retrieval/semantic/runtime.ts 的 ORT_WASM 一致（multilingual-e5-small.test.ts 檢查）。
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ORT_WASM_DIR = "ort";
// 不含 asyncify 的版本：只支援 wasm 後端（不支援 WebGPU），大小在單檔上限內（#163 決定 5）
export const ORT_WASM_FILES = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];
// Cloudflare 靜態檔的單檔上限 25 MiB（PR #128 審查時查證）
export const MAX_STATIC_FILE_BYTES = 25 * 1024 * 1024;
export const SEMANTIC_PROVIDERS = ["multilingual-e5-small"];

const ORT_DIST = fileURLToPath(new URL("../node_modules/onnxruntime-web/dist/", import.meta.url));

export function usesSemanticProvider(clientDir) {
  const config = JSON.parse(readFileSync(join(clientDir, "client.json"), "utf8"));
  return SEMANTIC_PROVIDERS.includes(config.retrieval?.provider);
}

// 超過單檔上限就失敗，不讓 build 產出部署不了的檔案
export function copyOrtWasm(outDir, sourceDir = ORT_DIST) {
  const target = join(outDir, ORT_WASM_DIR);
  mkdirSync(target, { recursive: true });
  for (const name of ORT_WASM_FILES) {
    const source = join(sourceDir, name);
    const { size } = statSync(source);
    if (size > MAX_STATIC_FILE_BYTES) throw new Error(`${name} 是 ${size} bytes，超過靜態檔單檔上限 ${MAX_STATIC_FILE_BYTES} bytes`);
    copyFileSync(source, join(target, name));
  }
}

// Vite 外掛：build 後依客戶設定複製；dev server 以 /ort/<檔名> 提供
export function ortWasmPlugin(clientDir, sourceDir = ORT_DIST) {
  let outDir;
  return {
    name: "kk-ort-wasm",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      if (usesSemanticProvider(clientDir)) copyOrtWasm(outDir, sourceDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split("?")[0].replace(`${server.config.base}${ORT_WASM_DIR}/`, "");
        if (!ORT_WASM_FILES.includes(name)) return next();
        res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        res.end(readFileSync(join(sourceDir, name)));
      });
    },
  };
}
