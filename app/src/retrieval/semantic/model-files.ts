// multilingual-e5-small（q8）的模型檔：固定的 Hugging Face commit、大小與 SHA-256（ADR 0006、ADR 0004）。
// 不讓 client.json 設定，避免繞過固定版本。大小與 LFS 檔的 SHA-256 取自 #126 的評估（docs/evals/semantic-retrieval-2026-11.md）；
// config.json、special_tokens_map.json、tokenizer_config.json 沒有 LFS 的 SHA-256，由人在本機從同一個 commit 下載後計算，
// 並以大小與 git blob SHA-1 確認和 #126 記錄的是同一份檔案（#163 決定第 4 點、PR #165 的修正要求）。
import type { EmbedKind } from "../types";

export interface ModelFile {
  // 相對於模型 repo 根目錄的路徑
  path: string;
  bytes: number;
  // 小寫 hex；null 表示尚未登記，載入時拒絕使用（日後換版本、雜湊還沒算好時用）
  sha256: string | null;
}

export interface ModelSpec {
  id: string;
  // commit SHA；不用 main 等會變動的 ref
  revision: string;
  prefix: Record<EmbedKind, string>;
  files: readonly ModelFile[];
}

export const E5_MODEL: ModelSpec = {
  id: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  // e5 系列：問題與段落要加不同前綴
  prefix: { query: "query: ", passage: "passage: " },
  files: [
    { path: "config.json", bytes: 658, sha256: "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1" },
    { path: "special_tokens_map.json", bytes: 167, sha256: "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7" },
    { path: "tokenizer_config.json", bytes: 443, sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b" },
    { path: "tokenizer.json", bytes: 17_082_730, sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39" },
    {
      path: "onnx/model_quantized.onnx",
      bytes: 118_308_185,
      sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
    },
  ],
};

export function modelFileUrl(model: Pick<ModelSpec, "id" | "revision">, path: string): string {
  return `https://huggingface.co/${model.id}/resolve/${model.revision}/${path}`;
}
