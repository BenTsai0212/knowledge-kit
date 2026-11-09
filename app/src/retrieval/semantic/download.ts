// 模型檔的下載與驗證：從固定 commit 下載，比對大小與 SHA-256 後才交出，以 Cache Storage 快取（ADR 0006）。
// transformers.js 本身不驗證雜湊，所以只把這裡交出的 bytes 交給它（multilingual-e5-small.ts）。
import { modelFileUrl, type ModelFile, type ModelSpec } from "./model-files";

export type ModelLoadFailure = "unregistered" | "http" | "size" | "sha256";

export class ModelLoadError extends Error {
  constructor(
    readonly reason: ModelLoadFailure,
    readonly path: string,
    detail: string,
  ) {
    // 給開發者的訊息；畫面上的提示依 reason 從 client/i18n/ 取得（providers.ts 的 FallbackReason）
    super(`model file ${path}: ${detail}`);
    this.name = "ModelLoadError";
  }
}

// 測試注入假的 fetch 與 CacheStorage，不連網
export interface DownloadDeps {
  fetch: (url: string) => Promise<Response>;
  caches: Pick<CacheStorage, "open">;
}

// 下載進度：loaded 是已取得的 bytes（含從快取讀到的檔案），total 是登記大小的合計（model-files.ts）。
// 只在需要連網下載時回報；全部從快取取得時不回報，畫面依此分辨「下載中」與「載入中」（#171）
export interface DownloadProgress {
  loaded: number;
  total: number;
}

export type ProgressListener = (progress: DownloadProgress) => void;

// commit 不同時用不同的快取，換版本後舊檔不會被誤用
export const cacheName = (model: Pick<ModelSpec, "revision">) => `kk-model-${model.revision}`;

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// 不符時回傳原因
async function mismatch(file: ModelFile & { sha256: string }, bytes: Uint8Array<ArrayBuffer>): Promise<ModelLoadFailure | null> {
  if (bytes.byteLength !== file.bytes) return "size";
  return (await sha256Hex(bytes)) === file.sha256 ? null : "sha256";
}

// 讀完回應的內容。有進度回呼時逐段讀取並回報已收到的 bytes；取得的 bytes 與 arrayBuffer() 相同，驗證不變
async function readBody(response: Response, onReceived?: (received: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  if (!onReceived || response.body === null) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onReceived(received);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// 依序處理（模型檔約 118 MB，不同時下載多個大檔）；回傳 路徑 → 驗證過的 bytes
export async function loadVerifiedFiles(
  model: ModelSpec,
  deps: DownloadDeps,
  onProgress?: ProgressListener,
): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const unregistered = model.files.find((f) => f.sha256 === null);
  // 在連網之前拒絕，雜湊沒登記齊全時一個檔都不下載
  if (unregistered) throw new ModelLoadError("unregistered", unregistered.path, "SHA-256 not registered");

  const cache = await deps.caches.open(cacheName(model));
  const verified = new Map<string, Uint8Array<ArrayBuffer>>();
  const total = model.files.reduce((sum, file) => sum + file.bytes, 0);
  // 已驗證的檔案的登記大小合計；下載中的檔案超過登記大小時，進度不超過該檔的大小（之後由大小檢查拒絕）
  let done = 0;
  const report = (received: number, file: ModelFile) => onProgress?.({ loaded: done + Math.min(received, file.bytes), total });
  for (const file of model.files as (ModelFile & { sha256: string })[]) {
    const url = modelFileUrl(model, file.path);
    const cached = await cache.match(url);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (!(await mismatch(file, bytes))) {
        verified.set(file.path, bytes);
        done += file.bytes;
        continue;
      }
      // 快取內容損壞或被改動：刪除後重新下載
      await cache.delete(url);
    }
    // 開始連網時先回報一次，畫面在收到第一段資料前就改顯示「下載中」
    report(0, file);
    // 連不上（離線、被擋）與 HTTP 錯誤同樣算下載失敗
    const response = await deps.fetch(url).catch((error: unknown) => {
      throw new ModelLoadError("http", file.path, `fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (!response.ok) throw new ModelLoadError("http", file.path, `HTTP ${response.status}`);
    const bytes = await readBody(response, onProgress && ((received) => report(received, file)));
    const failure = await mismatch(file, bytes);
    if (failure) throw new ModelLoadError(failure, file.path, failure === "size" ? `size ${bytes.byteLength} != ${file.bytes}` : "SHA-256 mismatch");
    await cache.put(url, new Response(bytes));
    verified.set(file.path, bytes);
    done += file.bytes;
  }
  return verified;
}
