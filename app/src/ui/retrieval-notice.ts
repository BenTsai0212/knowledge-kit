// 問答頁與評測台的檢索提示（docs/retrieval.md「準備中的提示」）：依 VectorProvider 的準備狀態決定顯示哪一種，畫面在 RetrievalNotice.tsx。
import type { DownloadProgress, ProviderFallback } from "../retrieval/providers";

// 準備中（需要下載時有進度），或已準備好（降級時有原因）
export type ProviderStatus = { state: "preparing"; progress: DownloadProgress | null } | { state: "ready"; fallback: ProviderFallback | null };

export type RetrievalNoticeState =
  | { kind: "loading" }
  | { kind: "downloading"; loaded: number; total: number }
  | { kind: "fallback"; fallback: ProviderFallback };

export const PREPARING: ProviderStatus = { state: "preparing", progress: null };

// preparesModel：providers.ts 的 preparesModel()。keyword-hash 不必準備，不顯示任何提示；語意向量準備中時，有下載進度顯示「下載中」，從快取載入或下載完成後在初始化時顯示「載入中」
export function retrievalNotice(preparesModel: boolean, status: ProviderStatus): RetrievalNoticeState | null {
  if (status.state === "ready") return status.fallback && { kind: "fallback", fallback: status.fallback };
  if (!preparesModel) return null;
  const { progress } = status;
  if (progress === null || progress.loaded >= progress.total) return { kind: "loading" };
  return { kind: "downloading", loaded: progress.loaded, total: progress.total };
}

// 展示模式（#260，docs/design.md「隱藏與保留」）：準備中（載入、下載）縮成頂端一個小點，完成後消失；降級的提示照常顯示
export const showsAsDot = (notice: RetrievalNoticeState | null, compact: boolean): boolean =>
  compact && (notice?.kind === "loading" || notice?.kind === "downloading");

// 以 MB（1024 × 1024 bytes）顯示、到小數一位；ADR 0006 的「約 129 MB」用同一個單位
export const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

// 顯示的數字沒變時不更新畫面：下載時每收到一段資料就回報一次
export function sameDisplay(a: ProviderStatus, b: ProviderStatus): boolean {
  if (a.state !== "preparing" || b.state !== "preparing") return false;
  if (a.progress === null || b.progress === null) return a.progress === b.progress;
  return megabytes(a.progress.loaded) === megabytes(b.progress.loaded) && a.progress.total === b.progress.total;
}
