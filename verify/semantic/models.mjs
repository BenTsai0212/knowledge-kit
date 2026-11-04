// #126 語意向量評估（verify 分支專用，不合併）：候選模型與固定的 Hugging Face commit、檔案雜湊。
// LFS 檔案以 Hugging Face API 回報的 SHA-256 驗證；小檔以 git blob（SHA-1）驗證，下載後另外記錄 SHA-256 到報告。
export const MODEL_DIR = new URL("../../.verify-models/", import.meta.url);

export const MODELS = [
  {
    key: "A1",
    id: "Xenova/multilingual-e5-small",
    upstream: "intfloat/multilingual-e5-small",
    revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
    // e5 系列：查詢與段落要加不同前綴
    prefix: { query: "query: ", passage: "passage: " },
    pooling: "mean",
    files: {
      "config.json": { size: 658, gitSha1: "4104f38273cc595fd9500fd243124e9f6cf383dc" },
      "special_tokens_map.json": { size: 167, gitSha1: "e0b1d18ecd0ae4ff1d47bd297d910c0cf83e504b" },
      "tokenizer_config.json": { size: 443, gitSha1: "059214673d9d6d2ee319411e2ffec8c024b816d5" },
      "tokenizer.json": { size: 17082730, sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39" },
      "onnx/model_quantized.onnx": { size: 118308185, sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193" },
    },
  },
  {
    key: "A2",
    id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    upstream: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    revision: "2c4055b12046f11709e9df2c122e59ffbdc2f900",
    prefix: { query: "", passage: "" },
    pooling: "mean",
    files: {
      "config.json": { size: 673, gitSha1: "ce7fe159b2eee53ef2b9704a72a4efa6c22248b4" },
      "special_tokens_map.json": { size: 280, gitSha1: "d5698132694f4f1bcff08fa7d937b1701812598e" },
      "tokenizer_config.json": { size: 496, gitSha1: "9f3bfd538ec86d360dc988dac25e3cfb0c4c14d5" },
      "tokenizer.json": { size: 17082913, sha256: "b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441" },
      "onnx/model_quantized.onnx": { size: 118308126, sha256: "66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc" },
    },
  },
];
