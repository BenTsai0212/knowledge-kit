// #126 語意向量評估（verify 分支專用，不合併）：以 transformers.js 執行候選多語 embedding 模型的 VectorProvider。
// 模型檔只從 .verify-models/ 讀取（download.mjs 已驗證雜湊），不連網。
// 現在的 embed(texts) 分不出查詢與段落；retrieve.ts 一律以 [問題, ...段落] 呼叫，所以第 1 筆當查詢（導入時改接口，見報告）。
import { AutoTokenizer, env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ProviderId } from "../../app/src/client/types";
import type { VectorProvider } from "../../app/src/retrieval/types";
// @ts-expect-error：.mjs 沒有型別
import { MODEL_DIR, MODELS } from "./models.mjs";

env.allowRemoteModels = false;
env.localModelPath = fileURLToPath(MODEL_DIR);

export type CandidateKey = "A1" | "A2";
export type Device = "cpu" | "wasm";

interface ModelInfo {
  key: CandidateKey;
  id: string;
  revision: string;
  prefix: { query: string; passage: string };
  pooling: "mean";
}

export const candidate = (key: CandidateKey): ModelInfo => (MODELS as ModelInfo[]).find((m) => m.key === key)!;

export interface SemanticProvider extends VectorProvider<Float32Array> {
  // 個別轉換（量測用）
  embedAs(texts: string[], kind: "query" | "passage"): Promise<Float32Array[]>;
  loadMs: number;
}

type Embed = (texts: string[]) => Promise<Float32Array[]>;

// cpu：transformers.js 的 Node 版（onnxruntime-node）
async function nativeEmbed(m: ModelInfo): Promise<Embed> {
  const extractor: FeatureExtractionPipeline = await pipeline("feature-extraction", m.id, { dtype: "q8", device: "cpu" });
  return async (texts) => {
    const out = await extractor(texts, { pooling: m.pooling, normalize: true });
    const [n, dim] = out.dims as [number, number];
    const data = out.data as Float32Array;
    return Array.from({ length: n }, (_, i) => data.slice(i * dim, (i + 1) * dim));
  };
}

// wasm：瀏覽器用的 onnxruntime-web（WASM 後端）在 Node 執行；transformers.js 的 Node 版不支援 wasm，
// 所以只借用它的 tokenizer，mean pooling 與正規化自己做（同 pipeline 的 pooling: "mean", normalize: true）
async function wasmEmbed(m: ModelInfo): Promise<Embed> {
  const ort = await import("onnxruntime-web");
  const tokenizer = await AutoTokenizer.from_pretrained(m.id);
  const model = readFileSync(fileURLToPath(new URL(`${m.id}/onnx/model_quantized.onnx`, MODEL_DIR)));
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  return async (texts) => {
    const enc = tokenizer(texts, { padding: true, truncation: true });
    const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {};
    for (const name of session.inputNames) {
      const t = enc[name] ?? { data: new BigInt64Array(enc.input_ids.data.length), dims: enc.input_ids.dims };
      feeds[name] = new ort.Tensor("int64", t.data as BigInt64Array, t.dims as number[]);
    }
    const out = (await session.run(feeds))[session.outputNames[0]];
    const [n, seq, dim] = out.dims as number[];
    const hidden = out.data as Float32Array;
    const mask = enc.attention_mask.data as BigInt64Array;
    return Array.from({ length: n }, (_, i) => {
      const v = new Float32Array(dim);
      let count = 0;
      for (let s = 0; s < seq; s++) {
        if (mask[i * seq + s] === 0n) continue;
        count++;
        for (let d = 0; d < dim; d++) v[d] += hidden[(i * seq + s) * dim + d];
      }
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += (v[d] /= count) ** 2;
      norm = Math.sqrt(norm);
      for (let d = 0; d < dim; d++) v[d] /= norm;
      return v;
    });
  };
}

export async function createSemanticProvider(key: CandidateKey, device: Device = "cpu"): Promise<SemanticProvider> {
  const m = candidate(key);
  const started = performance.now();
  const run = device === "cpu" ? await nativeEmbed(m) : await wasmEmbed(m);
  const loadMs = performance.now() - started;

  const embedAs = async (texts: string[], kind: "query" | "passage") =>
    texts.length === 0 ? [] : run(texts.map((t) => m.prefix[kind] + t));

  return {
    // verify 分支：ProviderId 只有 keyword-hash，id 只用於顯示
    id: `semantic-${key}` as ProviderId,
    loadMs,
    embedAs,
    async embed(texts) {
      const [query, ...passages] = texts;
      // 段落分批，避免一次的張量太大
      const vectors = [...(await embedAs([query], "query"))];
      for (let i = 0; i < passages.length; i += 16) vectors.push(...(await embedAs(passages.slice(i, i + 16), "passage")));
      return vectors;
    },
    similarity(a, b) {
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      // cosine 可能為負；接口要求 0～1
      return Math.min(1, Math.max(0, dot));
    },
  };
}
