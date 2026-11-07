// 檢索的向量接口。問答與資料層只依賴本接口；使用哪個實作只在 providers.ts 決定（docs/retrieval.md）。
import type { ProviderId } from "../client/types";

// 轉換的是問題（query）還是段落（passage）。語意模型可能對兩者加不同前綴（例如 e5 的 "query: "、"passage: "）
export type EmbedKind = "query" | "passage";

export interface VectorProvider<V = unknown> {
  // 與 client.json 中 retrieval 的 provider 相同
  readonly id: ProviderId;
  // 一次轉多筆同一種文字，讓需要呼叫外部 API 或模型的實作可以批次處理；不區分兩者的實作可忽略 kind
  embed(texts: string[], kind: EmbedKind): Promise<V[]>;
  // 0～1，越大越相關；cosine 為負時截到 0（providers.test.ts 對每個實作檢查範圍）
  similarity(a: V, b: V): number;
}
