// 決定使用哪個 VectorProvider 的唯一位置（providers.test.ts 檢查）。
// 新增實作：在 PROVIDERS 登記，並在 client.schema.json 的 retrieval.provider 與 types.ts 的 ProviderId 加上同名的值。
import type { ProviderId, RetrievalConfig } from "../client/types";
import { keywordHashProvider } from "./keyword-hash";
import type { VectorProvider } from "./types";

// 實作可能要先下載模型才能使用，所以登記建立實作的函式，並允許非同步
export type ProviderFactory = () => VectorProvider | Promise<VectorProvider>;

export const PROVIDERS: Record<ProviderId, ProviderFactory> = {
  "keyword-hash": () => keywordHashProvider,
};

export function createProvider(config: Pick<RetrievalConfig, "provider">): Promise<VectorProvider> {
  // 設定未經 check:client 時仍拒絕未登記的值；在呼叫當下拋錯，不延後到第一次檢索
  if (!Object.hasOwn(PROVIDERS, config.provider)) throw new Error(`未登記的 VectorProvider：${config.provider}`);
  return Promise.resolve(PROVIDERS[config.provider]());
}
