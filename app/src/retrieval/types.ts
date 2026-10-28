// 檢索的向量接口。問答與資料層只依賴本接口；使用哪個實作只在 providers.ts 決定（docs/retrieval.md）。
import type { ProviderId } from "../client/types";

export interface VectorProvider<V = unknown> {
  // 與 client.json 中 retrieval 的 provider 相同
  readonly id: ProviderId;
  // 問題與段落都用同一個函式轉成向量；一次轉多筆，讓需要呼叫外部 API 的實作可以批次處理
  embed(texts: string[]): Promise<V[]>;
  // 0～1，越大越相關
  similarity(a: V, b: V): number;
}
