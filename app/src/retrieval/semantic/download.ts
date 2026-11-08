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
    // 給開發者的訊息；畫面上的提示依 reason 從 client/i18n/ 取得（#163 PR 3）
    super(`model file ${path}: ${detail}`);
    this.name = "ModelLoadError";
  }
}

// 測試注入假的 fetch 與 CacheStorage，不連網
export interface DownloadDeps {
  fetch: (url: string) => Promise<Response>;
  caches: Pick<CacheStorage, "open">;
}

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

// 依序處理（模型檔約 118 MB，不同時下載多個大檔）；回傳 路徑 → 驗證過的 bytes
export async function loadVerifiedFiles(model: ModelSpec, deps: DownloadDeps): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const unregistered = model.files.find((f) => f.sha256 === null);
  // 在連網之前拒絕，雜湊沒登記齊全時一個檔都不下載
  if (unregistered) throw new ModelLoadError("unregistered", unregistered.path, "SHA-256 not registered");

  const cache = await deps.caches.open(cacheName(model));
  const verified = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const file of model.files as (ModelFile & { sha256: string })[]) {
    const url = modelFileUrl(model, file.path);
    const cached = await cache.match(url);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (!(await mismatch(file, bytes))) {
        verified.set(file.path, bytes);
        continue;
      }
      // 快取內容損壞或被改動：刪除後重新下載
      await cache.delete(url);
    }
    const response = await deps.fetch(url);
    if (!response.ok) throw new ModelLoadError("http", file.path, `HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const failure = await mismatch(file, bytes);
    if (failure) throw new ModelLoadError(failure, file.path, failure === "size" ? `size ${bytes.byteLength} != ${file.bytes}` : "SHA-256 mismatch");
    await cache.put(url, new Response(bytes));
    verified.set(file.path, bytes);
  }
  return verified;
}
