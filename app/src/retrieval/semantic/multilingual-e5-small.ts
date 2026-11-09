// 語意向量實作 multilingual-e5-small（ADR 0006）：模型檔經 download.ts 驗證後交給 transformers.js（runtime.ts）。
// 建立時就下載與初始化（下載進度交給 onProgress，見 download.ts）；失敗時由建立的 Promise 拋出（降級到 keyword-hash 由 providers.ts 處理）。
import type { ProviderId } from "../../client/types";
import type { EmbedKind, VectorProvider } from "../types";
import { loadVerifiedFiles, type ProgressListener } from "./download";
import { E5_MODEL, type ModelSpec } from "./model-files";
import type { Extractor } from "./runtime";

export const E5_PROVIDER_ID = "multilingual-e5-small" satisfies ProviderId;

// 一次交給模型的段落數，避免張量太大
export const BATCH_SIZE = 16;

// 測試注入假的載入與模型，不下載模型
export interface E5Deps {
  loadFiles: (model: ModelSpec, onProgress?: ProgressListener) => Promise<Map<string, Uint8Array<ArrayBuffer>>>;
  createExtractor: (model: ModelSpec, files: Map<string, Uint8Array<ArrayBuffer>>) => Promise<Extractor>;
}

const browserDeps: E5Deps = {
  loadFiles: (model, onProgress) => loadVerifiedFiles(model, { fetch: (url) => fetch(url), caches }, onProgress),
  createExtractor: async (model, files) => (await import("./runtime")).createTransformersExtractor(model, files),
};

export async function createE5Provider(deps: E5Deps = browserDeps, onProgress?: ProgressListener): Promise<VectorProvider<Float32Array>> {
  const model = E5_MODEL;
  const extract = await deps.createExtractor(model, await deps.loadFiles(model, onProgress));
  return {
    id: E5_PROVIDER_ID,
    async embed(texts: string[], kind: EmbedKind) {
      const vectors: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        vectors.push(...(await extract(texts.slice(i, i + BATCH_SIZE).map((t) => model.prefix[kind] + t))));
      }
      return vectors;
    },
    // 向量已正規化，內積即 cosine；負值截到 0（接口要求 0～1）
    similarity(a, b) {
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      return Math.min(1, Math.max(0, dot));
    },
  };
}
