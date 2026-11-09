// 決定使用哪個 VectorProvider 的唯一位置（providers.test.ts 檢查）。
// 新增實作：在 PROVIDERS 與 RETRIEVAL_DEFAULTS 登記，並在 client.schema.json 的 retrieval.provider 與 types.ts 的 ProviderId 加上同名的值。
import type { ProviderId, RetrievalConfig, RetrievalFile } from "../client/types";
import { keywordHashProvider } from "./keyword-hash";
import type { ModelLoadFailure, ProgressListener } from "./semantic/download";
import type { VectorProvider } from "./types";

// 畫面不直接匯入 semantic/（providers.test.ts 的結構測試），下載進度的型別由這裡轉出
export type { DownloadProgress, ProgressListener } from "./semantic/download";

// 實作可能要先下載模型才能使用，所以登記建立實作的函式，並允許非同步；需要下載的實作以 onProgress 回報進度
export type ProviderFactory = (onProgress?: ProgressListener) => VectorProvider | Promise<VectorProvider>;

export const PROVIDERS: Record<ProviderId, ProviderFactory> = {
  "keyword-hash": () => keywordHashProvider,
  // 動態 import：沒選用的客戶不下載語意模型的程式（ADR 0002）
  "multilingual-e5-small": async (onProgress) => (await import("./semantic/multilingual-e5-small")).createE5Provider(undefined, onProgress),
};

// 預設的實作，也是其他實作準備失敗時的降級目標
export const DEFAULT_PROVIDER = "keyword-hash" satisfies ProviderId;

// 省略 topK、minScore 時的值：分數分布依實作而不同（#163 決定 2）。keyword-hash 的列與 Schema 的 default 相同（load.test.ts 比對）
export const RETRIEVAL_DEFAULTS: Record<ProviderId, RetrievalConfig> = {
  "keyword-hash": { provider: "keyword-hash", topK: 5, minScore: 0.1 },
  "multilingual-e5-small": { provider: "multilingual-e5-small", topK: 5, minScore: 0.7 },
};

// client.json 的 retrieval 補上預設值（client/load.ts）；未登記的值保留，由 createProvider 拋錯
export function withRetrievalDefaults(file: RetrievalFile = {}): RetrievalConfig {
  const id = file.provider ?? DEFAULT_PROVIDER;
  return { ...RETRIEVAL_DEFAULTS[Object.hasOwn(RETRIEVAL_DEFAULTS, id) ? id : DEFAULT_PROVIDER], ...file };
}

// 選用的實作是否要先準備模型（下載與初始化）；畫面依此決定是否顯示「載入中」「下載中」的提示
export const preparesModel = (config: RetrievalConfig) => config.provider !== DEFAULT_PROVIDER;

// 降級的原因；畫面依此從 client/i18n/ 的 retrievalFallback 取提示
export type FallbackReason = "download" | "integrity" | "init";

export interface ProviderFallback {
  // client.json 選的實作
  from: ProviderId;
  reason: FallbackReason;
}

// 準備好的實作與檢索參數；沒有降級時 fallback 為 null
export interface ActiveProvider {
  provider: VectorProvider;
  options: Pick<RetrievalConfig, "topK" | "minScore">;
  fallback: ProviderFallback | null;
}

const INTEGRITY: readonly ModelLoadFailure[] = ["size", "sha256", "unregistered"];

// ModelLoadError（semantic/download.ts）以 name 判斷：instanceof 要靜態匯入，沒選用語意模型的客戶也會打包下載的程式
function fallbackReason(error: unknown): FallbackReason {
  if (!(error instanceof Error) || error.name !== "ModelLoadError") return "init";
  const { reason } = error as Error & { reason: ModelLoadFailure };
  return INTEGRITY.includes(reason) ? "integrity" : "download";
}

// onProgress：模型的下載進度（畫面的「下載中」提示，docs/retrieval.md「準備中的提示」）
export function createProvider(
  config: RetrievalConfig,
  factories: Record<ProviderId, ProviderFactory> = PROVIDERS,
  onProgress?: ProgressListener,
): Promise<ActiveProvider> {
  // 設定未經 check:client 時仍拒絕未登記的值；在呼叫當下拋錯，不延後到第一次檢索
  if (!Object.hasOwn(factories, config.provider)) throw new Error(`未登記的 VectorProvider：${config.provider}`);
  const options = { topK: config.topK, minScore: config.minScore };
  const ready = (async () => ({ provider: await factories[config.provider](onProgress), options, fallback: null }))();
  if (config.provider === DEFAULT_PROVIDER) return ready;
  // 下載、雜湊不符或初始化失敗：改用 keyword-hash。minScore 改用 keyword-hash 的預設值，語意模型的門檻對它太高，幾乎每題都會拒答
  return ready.catch(async (error: unknown) => {
    console.warn(`VectorProvider ${config.provider} failed; falling back to ${DEFAULT_PROVIDER}`, error);
    return {
      provider: await factories[DEFAULT_PROVIDER](),
      options: { ...options, minScore: RETRIEVAL_DEFAULTS[DEFAULT_PROVIDER].minScore },
      fallback: { from: config.provider, reason: fallbackReason(error) },
    };
  });
}
