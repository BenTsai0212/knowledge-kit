// 語意向量的瀏覽器量測（#163，docs/retrieval.md「瀏覽器量測」）：使用正式的 multilingual-e5-small provider
// （同一套固定 commit 下載、SHA-256 驗證、Cache Storage 快取與自己提供的 WASM），記錄第一次提問要等多久、下載量、各階段時間與記憶體。
// 開發用的量測工具，不是產品畫面，所以標籤只用英文、不放 client/i18n/；只在 npm run dev 提供，不進 dist/。
import { dataset } from "../src/dataset/load";
import { cacheName } from "../src/retrieval/semantic/download";
import { E5_MODEL, modelFileUrl } from "../src/retrieval/semantic/model-files";
import { createE5Provider } from "../src/retrieval/semantic/multilingual-e5-small";

const passages = Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => p.text));
const QUERY = "What is the material cost of the Bluewing desk?";
const QUERY_RUNS = 20;

const out = document.querySelector("#out")!;
const log = (line: string) => (out.textContent += line + "\n");
const since = (t: number) => Math.round(performance.now() - t);

document.querySelector("#clear")!.addEventListener("click", async () => {
  log(`cache ${cacheName(E5_MODEL)} deleted: ${await caches.delete(cacheName(E5_MODEL))}`);
});

document.querySelector("#run")!.addEventListener("click", async () => {
  try {
    // 開始前已在快取中的檔案不會再下載
    const cache = await caches.open(cacheName(E5_MODEL));
    const cached = new Set((await cache.keys()).map((r) => r.url));
    const downloadBytes = E5_MODEL.files.filter((f) => !cached.has(modelFileUrl(E5_MODEL, f.path))).reduce((n, f) => n + f.bytes, 0);

    // 與問答頁的第一次提問相同：建立 provider（下載、驗證、初始化）→ 轉全部段落 → 轉問題
    const start = performance.now();
    const provider = await createE5Provider();
    const loadMs = since(start);
    let t = performance.now();
    await provider.embed(passages, "passage");
    const passagesMs = since(t);
    t = performance.now();
    await provider.embed([QUERY], "query");
    const firstQueryMs = since(t);
    const firstQuestionMs = since(start);

    t = performance.now();
    for (let i = 0; i < QUERY_RUNS; i++) await provider.embed([`${QUERY} ${i}`], "query");
    const queryMs = +((performance.now() - t) / QUERY_RUNS).toFixed(1);
    // Chrome 才有 performance.memory
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    log(
      JSON.stringify({
        userAgent: navigator.userAgent,
        cores: navigator.hardwareConcurrency,
        crossOriginIsolated,
        cachedFiles: cached.size,
        downloadMB: +(downloadBytes / 2 ** 20).toFixed(1),
        firstQuestionMs,
        loadMs,
        passages: passages.length,
        passagesMs,
        firstQueryMs,
        queryMs,
        jsHeapMB: heap === undefined ? null : Math.round(heap / 2 ** 20),
      }),
    );
  } catch (error) {
    log(`failed: ${String(error)}`);
  }
});
