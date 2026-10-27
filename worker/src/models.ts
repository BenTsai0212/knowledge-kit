// 模型白名單：client.json 的 model 只能填這裡的鍵。實際模型名稱與 max_tokens 一律由此決定，不採用前端送來的值。
export interface ModelSpec {
  model: string;
  maxTokens: number;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
}

export const MODELS = {
  standard: { model: "claude-opus-5-5", maxTokens: 8000, effort: "low" },
} as const satisfies Record<string, ModelSpec>;

export type ModelCode = keyof typeof MODELS;

export function isModelCode(value: string): value is ModelCode {
  return Object.hasOwn(MODELS, value);
}
