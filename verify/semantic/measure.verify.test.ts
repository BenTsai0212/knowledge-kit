// #126 量測（verify 分支專用，不合併）：npx vitest run --config verify/semantic/vitest.config.ts measure
// 每個 provider 以 Node＋PGlite 執行 createRetriever()（不限名次、門檻 0），記錄答案段落的名次與分數、拒答題的最高分與效能。
// 結果寫到 .verify-models/results.json（不進版本控制）並輸出 Markdown 表格。
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, it } from "vitest";
import { clientConfig } from "../../app/src/client/load";
import { dataset } from "../../app/src/dataset/load";
import { seedDataset } from "../../app/src/dataset/seed";
import { openDatabase, type Database } from "../../app/src/db/database";
import { keywordHashProvider } from "../../app/src/retrieval/keyword-hash";
import { createRetriever } from "../../app/src/retrieval/retrieve";
import type { VectorProvider } from "../../app/src/retrieval/types";
import { createSemanticProvider, type CandidateKey, type Device } from "./provider";
import { QUESTIONS, type Kind } from "./questions";

const passages = Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => p.text));
const DEVICES: Device[] = (process.env.KK_VERIFY_DEVICES ?? "cpu,wasm").split(",") as Device[];
const KEYS: CandidateKey[] = (process.env.KK_VERIFY_MODELS ?? "A1,A2").split(",") as CandidateKey[];

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

interface Row {
  id: string;
  kind: Kind;
  expect: "answer" | "refusal";
  rank: number | null;
  answerScore: number | null;
  topScore: number;
  top3: string[];
}

async function rank(provider: VectorProvider): Promise<Row[]> {
  const retriever = createRetriever(db, provider, { topK: 1000, minScore: 0 });
  const rows: Row[] = [];
  for (const q of QUESTIONS) {
    const out = await retriever.retrieve(q.role, q.text, q.only ? { language: q.only } : {});
    const i = out.findIndex((p) => q.answers.includes(p.id));
    rows.push({
      id: q.id,
      kind: q.kind,
      expect: q.expect,
      // 權限拒答題的答案段落看不到，名次不計
      rank: q.expect === "answer" && i >= 0 ? i + 1 : null,
      answerScore: q.expect === "answer" && i >= 0 ? out[i].score : null,
      topScore: out[0]?.score ?? 0,
      top3: out.slice(0, 3).map((p) => p.id),
    });
  }
  return rows;
}

const f = (x: number) => x.toFixed(3);
const pct = (n: number, d: number) => (d === 0 ? "—" : `${n}/${d}`);

function summary(name: string, rows: Row[]) {
  const lines: string[] = [];
  const kinds: Kind[] = ["existing", "cross-zh-en", "cross-en-zh", "synonym"];
  lines.push(`\n#### ${name}\n`, "| 題型 | 題數 | @1 | @3 | @5 | MRR | 答案段落分數（最低／中位） |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const k of kinds) {
    const r = rows.filter((x) => x.kind === k && x.expect === "answer");
    const at = (n: number) => r.filter((x) => x.rank !== null && x.rank <= n).length;
    const mrr = r.reduce((s, x) => s + (x.rank ? 1 / x.rank : 0), 0) / r.length;
    const scores = r.map((x) => x.answerScore ?? 0).sort((p, q) => p - q);
    lines.push(`| ${k} | ${r.length} | ${pct(at(1), r.length)} | ${pct(at(3), r.length)} | ${pct(at(5), r.length)} | ${f(mrr)} | ${f(scores[0])}／${f(scores[Math.floor(scores.length / 2)])} |`);
  }
  const refusals = rows.filter((x) => x.expect === "refusal").sort((p, q) => q.topScore - p.topScore);
  lines.push("", `拒答題 ${refusals.length} 題的最高分（高到低）：${refusals.map((x) => `${x.id} ${f(x.topScore)}`).join("、")}`);
  const answers = rows.filter((x) => x.expect === "answer");
  const answerMin = Math.min(...answers.map((x) => x.answerScore ?? 0));
  const refusalMax = refusals[0]?.topScore ?? 0;
  const below = (t: number) => answers.filter((x) => (x.answerScore ?? 0) < t).length;
  const above = (t: number) => refusals.filter((x) => x.topScore >= t).length;
  lines.push(`答案段落最低分 ${f(answerMin)}，拒答題最高分 ${f(refusalMax)}；`);
  for (const t of [0.1, 0.2, 0.3, 0.5, 0.7, 0.75, 0.8, 0.85]) {
    lines.push(`- minScore ${t}：答案段落低於門檻 ${below(t)}/${answers.length}，拒答題仍有段落 ${above(t)}/${refusals.length}`);
  }
  const misses = answers.filter((x) => x.rank === null || x.rank > 5).map((x) => `${x.id}（${x.rank ?? "—"}，前 3：${x.top3.join(" ")}）`);
  lines.push("", `第 5 名以外：${misses.join("；") || "無"}`);
  return lines.join("\n");
}

const mem = () => Math.round(process.memoryUsage().rss / 2 ** 20);

it("量測", { timeout: 1_800_000 }, async () => {
  const results: Record<string, unknown> = {};
  const out: string[] = [];

  const kh = await rank(keywordHashProvider);
  results["keyword-hash"] = kh;
  out.push(summary("keyword-hash", kh));

  for (const key of KEYS) {
    for (const device of DEVICES) {
      const rssBefore = mem();
      const provider = await createSemanticProvider(key, device);
      const rssLoaded = mem();
      // 全部段落的向量（retrieve 的快取第一次就是算這些）
      let t = performance.now();
      await provider.embed(["warm-up", ...passages]);
      const passagesMs = performance.now() - t;
      const rssEmbedded = mem();
      t = performance.now();
      for (const q of QUESTIONS.slice(0, 20)) await provider.embedAs([q.text], "query");
      const queryMs = (performance.now() - t) / 20;
      const perf = { device, loadMs: Math.round(provider.loadMs), passages: passages.length, passagesMs: Math.round(passagesMs), queryMs: Math.round(queryMs), rssBefore, rssLoaded, rssEmbedded };
      out.push(`\n${key} ${device}：${JSON.stringify(perf)}`);
      results[`${key}-${device}-perf`] = perf;
      // 品質只以第一種裝置量測（兩種後端的數值差異另外比較）
      if (device === DEVICES[0]) {
        const rows = await rank(provider);
        results[key] = rows;
        out.push(summary(`${key}（${device}）`, rows));
      } else {
        const [v1] = await provider.embedAs([passages[0]], "passage");
        const ref = await createSemanticProvider(key, DEVICES[0]);
        const [v0] = await ref.embedAs([passages[0]], "passage");
        out.push(`${key} ${device} 與 ${DEVICES[0]} 的 cosine：${f(provider.similarity(v0, v1))}`);
      }
    }
  }
  writeFileSync(new URL("../../.verify-models/results.json", import.meta.url), JSON.stringify(results, null, 2));
  writeFileSync(new URL("../../.verify-models/results.md", import.meta.url), out.join("\n"));
});
