// 以 transformers.js 執行模型。整個 app 只有這裡載入 @huggingface/transformers，而且以動態 import 載入（ADR 0002），
// 沒選用語意模型的客戶不會下載它（multilingual-e5-small.test.ts 檢查）。
import type { ModelSpec } from "./model-files";
import { modelFileUrl } from "./model-files";

// 一次轉多筆，回傳 mean pooling 後 L2 正規化的向量
export type Extractor = (texts: string[]) => Promise<Float32Array[]>;

// 自己提供的 ONNX Runtime WASM（build 時由 vite.config.ts 複製到 dist/ort/，檔名與 scripts/ort-wasm.mjs 一致）。
// 不含 asyncify 的版本只支援 wasm 後端，不支援 WebGPU；本站沒有 COOP／COEP 標頭，所以是單執行緒（#163 決定 5）
export const ORT_WASM_DIR = "ort";
export const ORT_WASM = { wasm: "ort-wasm-simd-threaded.wasm", mjs: "ort-wasm-simd-threaded.mjs" } as const;

// 只回應驗證過、而且在 model-files.ts 登記過的檔案；transformers.js 先查快取，查到就不會自己下載。
// 同一份 bytes 同時以固定 commit 與 main 兩種網址回應：transformers.js 4.3.2 的 pipeline() 先以
// get_pipeline_files() 讀 config.json、檢查 tokenizer_config.json，這段沒有把 revision 傳下去，改查 main（#168）。
// 內容仍是固定 commit 驗證過的檔案，不會因此取得 main 上的版本。升級 transformers.js 時重新確認是否還需要 main。
export function verifiedCache(model: ModelSpec, files: Map<string, Uint8Array<ArrayBuffer>>) {
  const registered = new Set(model.files.map((file) => file.path));
  const byUrl = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [path, bytes] of files) {
    if (!registered.has(path)) continue;
    for (const revision of [model.revision, "main"]) byUrl.set(modelFileUrl({ ...model, revision }, path), bytes);
  }
  return {
    async match(request: string) {
      const bytes = byUrl.get(request);
      return bytes && new Response(bytes, { headers: { "content-length": String(bytes.byteLength) } });
    },
    // 快取由 download.ts 管理
    async put() {},
  };
}

type TransformersEnv = Awaited<typeof import("@huggingface/transformers")>["env"];

// 模型檔只從 verifiedCache 取得：不從遠端下載、不用它自己的快取；查不到的檔案一律當作不存在
export function useVerifiedFilesOnly(env: TransformersEnv, model: ModelSpec, files: Map<string, Uint8Array<ArrayBuffer>>) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = verifiedCache(model, files);
  env.fetch = async () => new Response(null, { status: 404 });
}

export async function createTransformersExtractor(
  model: ModelSpec,
  files: Map<string, Uint8Array<ArrayBuffer>>,
  wasmBase = `${import.meta.env.BASE_URL}${ORT_WASM_DIR}/`,
): Promise<Extractor> {
  const { env, pipeline } = await import("@huggingface/transformers");
  useVerifiedFilesOnly(env, model, files);
  // WASM 由 ONNX Runtime 直接從 dist/ 載入，不經 transformers.js 的 WASM 快取，也不用預設的 jsDelivr
  env.useWasmCache = false;
  const wasm = env.backends.onnx.wasm;
  if (!wasm) throw new Error("ONNX Runtime has no wasm backend");
  wasm.wasmPaths = { wasm: wasmBase + ORT_WASM.wasm, mjs: wasmBase + ORT_WASM.mjs };
  wasm.numThreads = 1;

  const extractor = await pipeline("feature-extraction", model.id, { dtype: "q8", device: "wasm", revision: model.revision });
  return async (texts) => {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const [rows, dim] = output.dims as [number, number];
    const data = output.data as Float32Array;
    return Array.from({ length: rows }, (_, i) => data.slice(i * dim, (i + 1) * dim));
  };
}
