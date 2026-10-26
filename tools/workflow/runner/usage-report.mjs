#!/usr/bin/env node
// 彙整 runner 的使用量：讀取 log 資料夾中 *-claude-<Issue>.log 結尾的 result 事件。
// 用法：node tools/workflow/runner/usage-report.mjs [--since 2026-10-13]
// log 資料夾依設定檔的 logDir（預設 tools/workflow/runner/logs）。
// 「API 等值」是 claude 依 API 公開價格換算的參考值；使用訂閱登入時不會另外收費，只代表用量大小。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, repoRoot, resolvePaths } from './config.mjs';

const { logDir: LOG_DIR } = resolvePaths(readConfig() ?? {}, repoRoot());
const i = process.argv.indexOf('--since');
const since = i > 0 ? new Date(process.argv[i + 1]) : new Date(0);

if (!existsSync(LOG_DIR)) {
  console.log(`找不到 log 資料夾：${LOG_DIR}`);
  process.exit(0);
}

const runs = [];
for (const name of readdirSync(LOG_DIR).filter((n) => /-claude-\d+\.log$/.test(n)).sort()) {
  const started = new Date(name.slice(0, 24).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z'));
  if (started < since) continue;
  const issue = name.match(/-claude-(\d+)\.log$/)[1];
  let result = null;
  let billing = '?';
  for (const line of readFileSync(join(LOG_DIR, name), 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === 'system' && e.subtype === 'init') billing = e.apiKeySource === 'none' ? '訂閱' : `API(${e.apiKeySource})`;
      if (e.type === 'result') result = e;
    } catch {}
  }
  const u = result?.usage ?? {};
  runs.push({
    date: started.toLocaleDateString('sv-SE'), issue, billing,
    ok: result ? (result.is_error ? '錯誤' : '完成') : '未完成',
    turns: result?.num_turns ?? 0, minutes: (result?.duration_ms ?? 0) / 60000, usd: result?.total_cost_usd ?? 0,
    input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0,
  });
}

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
console.log('日期        Issue  結果    計費  輪數  分鐘   新輸入   快取讀取  輸出    API等值');
for (const r of runs) {
  console.log([r.date, `#${r.issue}`.padEnd(6), r.ok.padEnd(5), r.billing.padEnd(4), String(r.turns).padStart(4),
    r.minutes.toFixed(1).padStart(6), fmt(r.input).padStart(8), fmt(r.cached).padStart(9), fmt(r.output).padStart(7),
    `$${r.usd.toFixed(2)}`.padStart(8)].join('  '));
}

const sum = (k) => runs.reduce((a, r) => a + r[k], 0);
console.log(`\n共 ${runs.length} 次：${sum('turns')} 輪、${sum('minutes').toFixed(0)} 分鐘、輸出 ${fmt(sum('output'))}、快取讀取 ${fmt(sum('cached'))}、API 等值 $${sum('usd').toFixed(2)}`);
const days = {};
for (const r of runs) days[r.date] = (days[r.date] ?? 0) + r.usd;
console.log('每日 API 等值：' + Object.entries(days).map(([d, v]) => `${d} $${v.toFixed(2)}`).join('、'));
