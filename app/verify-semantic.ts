// #126 瀏覽器量測（verify 分支專用，不合併）：從 Hugging Face 的固定 commit 下載 q8 模型（無快取時的首次載入），
// 量測下載量、載入時間、43 段的向量時間、單次查詢時間與 JS heap。
// 量測前在 DevTools 的 Network 勾選 Disable cache，並清除 Application > Cache Storage 的 transformers-cache。
import { env, pipeline } from "@huggingface/transformers";
// @ts-expect-error：.mjs 沒有型別
import { MODELS } from "../verify/semantic/models.mjs";

const documents = import.meta.glob("../client/data/documents/*.json", { eager: true, import: "default" });
const passages = Object.values(documents).flatMap((d) => (d as { passages: { text: string }[] }).passages.map((p) => p.text));
const out = document.querySelector("#out")!;
const log = (line: string) => (out.textContent += line + "\n");

env.allowLocalModels = false;
env.useBrowserCache = false;

document.querySelector("#run")!.addEventListener("click", async () => {
  const key = (document.querySelector("#model") as HTMLSelectElement).value;
  const device = (document.querySelector("#device") as HTMLSelectElement).value as "wasm" | "webgpu";
  const m = (MODELS as { key: string; id: string; revision: string; prefix: { query: string; passage: string } }[]).find((x) => x.key === key)!;
  performance.clearResourceTimings();
  const t0 = performance.now();
  const extractor = await pipeline("feature-extraction", m.id, { dtype: "q8", device, revision: m.revision });
  const loadMs = performance.now() - t0;
  let t = performance.now();
  await extractor(passages.map((p) => m.prefix.passage + p), { pooling: "mean", normalize: true });
  const passagesMs = performance.now() - t;
  t = performance.now();
  for (let i = 0; i < 20; i++) await extractor([m.prefix.query + passages[i]], { pooling: "mean", normalize: true });
  const queryMs = (performance.now() - t) / 20;
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const bytes = resources.reduce((s, r) => s + (r.transferSize || r.encodedBodySize), 0);
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  log(
    JSON.stringify({
      key,
      device,
      userAgent: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
      downloadedMB: +(bytes / 2 ** 20).toFixed(1),
      loadMs: Math.round(loadMs),
      passages: passages.length,
      passagesMs: Math.round(passagesMs),
      queryMs: +queryMs.toFixed(1),
      jsHeapMB: heap ? Math.round(heap / 2 ** 20) : null,
    }),
  );
});
