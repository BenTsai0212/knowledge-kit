// #126 效能（verify 分支專用）：一個候選 × 一種後端，在獨立的 Node 行程量測（perf.mjs 逐一啟動）。
// node verify/semantic/perf-one.ts A1 cpu
import { readFileSync, readdirSync } from "node:fs";
import { createSemanticProvider, type CandidateKey, type Device } from "./provider.ts";

const [key, device] = process.argv.slice(2) as [CandidateKey, Device];
const dir = new URL("../../client/data/documents/", import.meta.url);
const passages = readdirSync(dir).flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")).passages.map((p: { text: string }) => p.text));
const mb = (x: number) => Math.round(x / 2 ** 20);
const rss0 = process.memoryUsage().rss;

const provider = await createSemanticProvider(key, device);
const rssLoaded = process.memoryUsage().rss;
let t = performance.now();
const vectors = await provider.embed(["warm-up", ...passages]);
const passagesMs = performance.now() - t;
// 段落數放大 10 倍（重複文字）估計大一點的資料集
const many = Array.from({ length: 10 }, () => passages).flat();
t = performance.now();
await provider.embed(["warm-up", ...many]);
const passagesX10Ms = performance.now() - t;
t = performance.now();
for (let i = 0; i < 20; i++) await provider.embedAs([passages[i]], "query");
const queryMs = (performance.now() - t) / 20;

console.log(
  JSON.stringify({
    key,
    device,
    dim: vectors[0].length,
    loadMs: Math.round(provider.loadMs),
    passages: passages.length,
    passagesMs: Math.round(passagesMs),
    passagesX10: many.length,
    passagesX10Ms: Math.round(passagesX10Ms),
    queryMs: Number(queryMs.toFixed(1)),
    rssStartMB: mb(rss0),
    rssLoadedMB: mb(rssLoaded),
    rssEndMB: mb(process.memoryUsage().rss),
    maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
  }),
);
