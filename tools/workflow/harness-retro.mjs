#!/usr/bin/env node
// harness 指標（dev-workflow-template#5）：計算期間內的 PR、修正要求、agent 停止、CI 首次通過率、人的介入、等待人的工作、規則文件修改次數。
// 用法：node tools/workflow/harness-retro.mjs --since <YYYY-MM-DD> [--until <YYYY-MM-DD>] [--repo <owner/name>]
// 未指定 --repo 時用目前目錄的 origin。只以 gh api 讀取，不寫入 GitHub。輸出 Markdown。
// 計算邏輯是純函式（不呼叫 gh），測試見 harness-retro.test.mjs。
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DAY_MS = 86400e3;
export const HEADINGS = {
  stop: '## agent 停止',
  decision: '## 決定',
  changeRequest: '## 修正要求',
  mergeAuth: '## 合併授權',
};
export const CHANGES_REQUESTED = 'changes-requested';
export const WAITING_LABELS = ['blocked', 'needs-human'];
export const RULE_DOC_PATHS = ['AGENTS.md', 'docs/workflow'];
// workflow run 可能比 PR 建立稍早觸發（同一秒）；比對時容許的誤差
const RUN_SLACK_MS = 60e3;

// ---- 參數 ----

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 解析參數；回傳 { since, until, repo, errors }。until 預設為 today（YYYY-MM-DD）。 */
export function parseArgs(argv, today) {
  const out = { since: null, until: today, repo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') out.since = argv[++i];
    else if (a === '--until') out.until = argv[++i];
    else if (a === '--repo') out.repo = argv[++i];
    else out.unknown = a;
  }
  const errors = [];
  if (!out.since || !DATE.test(out.since)) errors.push('--since 必須是 YYYY-MM-DD');
  if (!out.until || !DATE.test(out.until)) errors.push('--until 必須是 YYYY-MM-DD');
  if (!errors.length && out.since > out.until) errors.push('--since 不能晚於 --until');
  if (out.repo && !/^[\w.-]+\/[\w.-]+$/.test(out.repo)) errors.push('--repo 必須是 owner/name');
  if (out.unknown) errors.push(`不認得的參數：${out.unknown}`);
  delete out.unknown;
  return { ...out, errors };
}

/** 期間（UTC）：since 當天 00:00 起，到 until 當天結束（不含隔天 00:00）。 */
export function period(since, until) {
  return { since, until, startMs: Date.parse(`${since}T00:00:00Z`), endMs: Date.parse(`${until}T00:00:00Z`) + DAY_MS };
}

export const inPeriod = (iso, p) => {
  const t = Date.parse(iso);
  return t >= p.startMs && t < p.endMs;
};

/** 從 git remote 網址取出 owner/name（https 與 SSH 兩種寫法）。 */
export function repoFromRemote(url) {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

// ---- 指標（純函式） ----

/** 期間內建立的 PR：已合併、開啟中、關閉未合併。 */
export function summarizePrs(prs) {
  const merged = prs.filter((p) => p.merged_at).length;
  const open = prs.filter((p) => p.state === 'open').length;
  return { total: prs.length, merged, open, closed: prs.length - merged - open };
}

/** 曾被要求修正的 PR：eventsByPr 是 { PR 編號: Issue events }；依 PR 去重，輪數是加標籤的次數。 */
export function changeRequests(eventsByPr) {
  const rounds = Object.entries(eventsByPr)
    .map(([pr, events]) => ({
      pr: Number(pr),
      rounds: events.filter((e) => e.event === 'labeled' && e.label?.name === CHANGES_REQUESTED).length,
    }))
    .filter((r) => r.rounds > 0)
    .sort((a, b) => a.pr - b.pr);
  return { prs: rounds.length, rounds: rounds.reduce((n, r) => n + r.rounds, 0), detail: rounds };
}

const startsWithHeading = (body, heading) => String(body ?? '').trimStart().startsWith(heading);
const issueNumber = (c) => Number(/\/issues\/(\d+)$/.exec(c.issue_url ?? '')?.[1] ?? NaN);

/** 以標題分類期間內建立的留言：agent 停止（含原因）、決定、修正要求、合併授權。 */
export function headingComments(comments, p) {
  const inP = comments.filter((c) => inPeriod(c.created_at, p));
  const pick = (h) => inP.filter((c) => startsWithHeading(c.body, h));
  const stops = pick(HEADINGS.stop).map((c) => ({
    number: issueNumber(c),
    reason: String(c.body).trimStart().split(/\r?\n/)[0].replace(/^## agent 停止[：:]?\s*/, '') || '（未寫原因）',
  }));
  return {
    stops,
    stopTargets: new Set(stops.map((s) => s.number)).size,
    decisions: pick(HEADINGS.decision).length,
    changeRequests: pick(HEADINGS.changeRequest).length,
    mergeAuths: pick(HEADINGS.mergeAuth).length,
  };
}

/**
 * CI 首次通過率。每個 PR 取它最早的 head commit（第一次 push），看該 commit 由 pull_request 事件觸發的每個 workflow
 * 的第一個 run：全部成功、且沒有重新執行（run_attempt 為 1）才算通過。
 * run 對應 PR：run.pull_requests 含該 PR，或分支相同且在 PR 開啟期間內觸發（合併後 pull_requests 可能是空的）。
 * 回傳 { passed, total, noRuns }；沒有任何 run 的 PR 不計入 total。
 */
export function ciFirstPass(prs, runs) {
  let passed = 0;
  let total = 0;
  let noRuns = 0;
  for (const pr of prs) {
    const start = Date.parse(pr.created_at) - RUN_SLACK_MS;
    const end = pr.closed_at ? Date.parse(pr.closed_at) : Infinity;
    const mine = runs.filter((r) => r.event === 'pull_request' && (
      (r.pull_requests ?? []).some((x) => x.number === pr.number)
      || (r.head_branch === pr.head?.ref && Date.parse(r.created_at) >= start && Date.parse(r.created_at) <= end)
    ));
    if (!mine.length) {
      noRuns++;
      continue;
    }
    const byTime = [...mine].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const firstSha = byTime[0].head_sha;
    const firstPerWorkflow = new Map();
    for (const r of byTime) {
      if (r.head_sha === firstSha && !firstPerWorkflow.has(r.workflow_id)) firstPerWorkflow.set(r.workflow_id, r);
    }
    total++;
    if ([...firstPerWorkflow.values()].every((r) => r.conclusion === 'success' && r.run_attempt === 1)) passed++;
  }
  return { passed, total, noRuns };
}

/** 等待人的工作：開啟中、帶 blocked 或 needs-human 的 Issue／PR，以及非 Draft 的開啟中 PR。 */
export function waiting(openIssues, openPrs) {
  const count = (label) => openIssues.filter((i) => (i.labels ?? []).some((l) => l.name === label)).length;
  return {
    blocked: count('blocked'),
    needsHuman: count('needs-human'),
    readyPrs: openPrs.filter((p) => !p.draft).length,
  };
}

/** 規則文件修改次數：各路徑的 commit 合併去重。 */
export function ruleDocCommits(commitLists) {
  return new Set(commitLists.flat().map((c) => c.sha)).size;
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

/** 輸出 Markdown；每項指標附算法與限制。 */
export function renderReport({ repo, p, prs, cr, comments, ci, wait, ruleDocs, generatedAt }) {
  const lines = [
    `# harness 指標：${repo}`,
    '',
    `- 期間：${p.since} ～ ${p.until}（UTC，以 PR 與留言的建立時間為準）`,
    `- 產生時間：${generatedAt}`,
    '',
    '| 指標 | 值 | 算法與限制 |',
    '| --- | --- | --- |',
    `| PR 數 | ${prs.total}（已合併 ${prs.merged}、開啟中 ${prs.open}、關閉未合併 ${prs.closed}） | 期間內建立的 PR |`,
    `| 曾被要求修正的 PR | ${cr.prs}（共 ${cr.rounds} 輪） | 期間內建立的 PR 中，Issue events 有 \`labeled: ${CHANGES_REQUESTED}\` 的；輪數是加標籤的次數 |`,
    `| agent 停止 | ${comments.stops.length} 次（${comments.stopTargets} 張 Issue／PR） | 期間內開頭是 \`${HEADINGS.stop}\` 的留言；agent 與人共用帳號時只能依標題判斷 |`,
    `| CI 首次通過率 | ${pct(ci.passed, ci.total)}（${ci.passed}／${ci.total}） | 每個 PR 第一個 push 的 commit，其 \`pull_request\` 事件觸發的每個 workflow 第一次執行都成功；重新執行過算失敗；沒有 workflow run 的 PR（${ci.noRuns} 個）不計入 |`,
    `| 人的介入 | \`## 決定\` ${comments.decisions}、\`## 修正要求\` ${comments.changeRequests}、\`## 合併授權\` ${comments.mergeAuths} | 期間內 Issue／PR 留言的開頭標題；以標題判斷，不分帳號；PR 審查（review）的內文不計 |`,
    `| 等待人的工作 | \`blocked\` ${wait.blocked}、\`needs-human\` ${wait.needsHuman}、非 Draft 的開啟中 PR ${wait.readyPrs} | 執行當下的狀態（GitHub API 無法還原過去某天的標籤），不是期間結束時 |`,
    `| 規則文件修改次數 | ${ruleDocs} | 預設分支上期間內修改 ${RULE_DOC_PATHS.map((x) => `\`${x}\``).join(' 或 ')} 的 commit 數 |`,
  ];
  if (comments.stops.length) {
    lines.push('', '## agent 停止的原因', '', ...comments.stops.map((s) => `- #${s.number}：${s.reason}`));
  }
  if (cr.detail.length) {
    lines.push('', '## 被要求修正的 PR', '', ...cr.detail.map((r) => `- #${r.pr}：${r.rounds} 輪`));
  }
  return lines.join('\n') + '\n';
}

// ---- gh api（只讀） ----

// gh api 的輸出上限：execFileSync 預設只有 1 MB，資料量大的 repo 一頁（100 筆）就可能超過（dev-workflow-template#60）
export const GH_MAX_BUFFER = 64 * 1024 * 1024;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const isRateLimit = (text) => /rate limit|HTTP 429|secondary rate/i.test(text);

/**
 * 呼叫 gh api（只讀：不帶 -X／--method、-f、-F）。遇到速率限制時等待後重試，超過次數時丟出說明；
 * 輸出超過 GH_MAX_BUFFER（ENOBUFS）時不重試，丟出說明。
 * run、sleep 可替換，方便測試。
 */
export function ghApi(path, { run, sleep = sleepSync, attempts = 3, waitMs = 60e3 } = {}) {
  const exec = run ?? ((args) => execFileSync('gh', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GH_MAX_BUFFER,
  }));
  for (let i = 1; ; i++) {
    try {
      return JSON.parse(exec(['api', '-H', 'Accept: application/vnd.github+json', path]) || 'null');
    } catch (error) {
      // 輸出超過上限：重試也一樣，改以說明停止（dev-workflow-template#60）
      if (error.code === 'ENOBUFS' || /\bENOBUFS\b/.test(error.message ?? '')) {
        throw new Error(`單頁資料過大，超過 ${GH_MAX_BUFFER / 1024 / 1024} MB 的讀取上限：${path}`);
      }
      const text = `${error.message}\n${error.stderr ?? ''}`;
      if (!isRateLimit(text)) throw error;
      if (i >= attempts) throw new Error(`GitHub API 速率限制，重試 ${attempts} 次仍失敗，請稍後再執行：${path}`);
      sleep(waitMs);
    }
  }
}

/** 逐頁讀取陣列（per_page=100）；stop(item) 回傳 true 時提早結束（用於依建立時間排序的清單）。 */
export function pages(path, { api, key, stop } = {}) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = api(`${path}${sep}per_page=100&page=${page}`);
    const items = key ? data?.[key] ?? [] : data ?? [];
    for (const item of items) {
      if (stop?.(item)) return out;
      out.push(item);
    }
    if (items.length < 100) return out;
  }
}

function collect(repo, p, api) {
  const R = `repos/${repo}`;
  const allPrs = pages(`${R}/pulls?state=all&sort=created&direction=desc`, {
    api, stop: (pr) => Date.parse(pr.created_at) < p.startMs,
  });
  const prs = allPrs.filter((pr) => inPeriod(pr.created_at, p));
  const eventsByPr = Object.fromEntries(prs.map((pr) => [pr.number, pages(`${R}/issues/${pr.number}/events`, { api })]));
  const since = new Date(p.startMs).toISOString();
  const until = new Date(p.endMs).toISOString();
  const comments = pages(`${R}/issues/comments?since=${since}&sort=created&direction=asc`, { api });
  const runs = pages(`${R}/actions/runs?event=pull_request&created=${p.since}..${new Date(p.endMs + 7 * DAY_MS).toISOString().slice(0, 10)}`, {
    api, key: 'workflow_runs',
  });
  const openIssues = WAITING_LABELS.flatMap((l) => pages(`${R}/issues?state=open&labels=${l}`, { api }));
  const openPrs = pages(`${R}/pulls?state=open`, { api });
  const commitLists = RULE_DOC_PATHS.map((path) => pages(`${R}/commits?path=${path}&since=${since}&until=${until}`, { api }));
  return { prs, eventsByPr, comments, runs, openIssues, openPrs, commitLists };
}

/** 從讀到的資料計算所有指標（純函式）。 */
export function computeMetrics(data, p) {
  return {
    prs: summarizePrs(data.prs),
    cr: changeRequests(data.eventsByPr),
    comments: headingComments(data.comments, p),
    ci: ciFirstPass(data.prs, data.runs),
    wait: waiting(data.openIssues, data.openPrs),
    ruleDocs: ruleDocCommits(data.commitLists),
  };
}

function main(argv) {
  const today = new Date().toISOString().slice(0, 10);
  const args = parseArgs(argv, today);
  if (args.errors.length) {
    console.error(`${args.errors.join('\n')}\n用法：node tools/workflow/harness-retro.mjs --since <YYYY-MM-DD> [--until <YYYY-MM-DD>] [--repo <owner/name>]`);
    process.exitCode = 2;
    return;
  }
  let repo = args.repo;
  if (!repo) {
    try {
      repo = repoFromRemote(execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }));
    } catch {}
    if (!repo) {
      console.error('無法從 origin 判斷 repo，請加上 --repo <owner/name>');
      process.exitCode = 2;
      return;
    }
  }
  const p = period(args.since, args.until);
  const api = (path) => ghApi(path);
  try {
    const data = collect(repo, p, api);
    process.stdout.write(renderReport({ repo, p, ...computeMetrics(data, p), generatedAt: new Date().toISOString() }));
  } catch (error) {
    console.error(`讀取失敗：${error.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
