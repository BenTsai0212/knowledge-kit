// 預設的 VectorProvider：關鍵字＋字元特徵以 FNV-1a 雜湊到同一個稀疏向量，L2 正規化後以 cosine 計分。
// 非語意模型：只比對共同的詞與字元，不懂同義詞，也不支援跨語言。
import { tokenize } from "./tokenize";
import type { VectorProvider } from "./types";

// 維度 → 權重
export type SparseVector = Map<number, number>;

export const DIMENSIONS = 4096;
// #22 決定 3：比重為常數，不放進設定
export const KEYWORD_WEIGHT = 1;
export const CHAR_WEIGHT = 0.5;

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const c of text) {
    hash ^= c.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function embedText(text: string): SparseVector {
  const { keywords, chars } = tokenize(text);
  const vector: SparseVector = new Map();
  const add = (feature: string, weight: number) => {
    const i = fnv1a(feature) % DIMENSIONS;
    vector.set(i, (vector.get(i) ?? 0) + weight);
  };
  // 前綴區分兩種特徵，例如關鍵字「薪資」與字元「薪」
  for (const k of keywords) add(`k:${k}`, KEYWORD_WEIGHT);
  for (const c of chars) add(`c:${c}`, CHAR_WEIGHT);
  const norm = Math.sqrt([...vector.values()].reduce((sum, x) => sum + x * x, 0));
  for (const [i, x] of vector) vector.set(i, x / norm);
  return vector;
}

// 兩個向量都已正規化且權重非負，內積即為 cosine，範圍 0～1
export function cosine(a: SparseVector, b: SparseVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [i, x] of small) sum += x * (large.get(i) ?? 0);
  return Math.min(1, sum);
}

export const keywordHashProvider: VectorProvider<SparseVector> = {
  id: "keyword-hash",
  // 問題與段落轉法相同，不使用 kind
  embed: async (texts) => texts.map(embedText),
  similarity: cosine,
};
