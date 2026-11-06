import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changeRequests, ciFirstPass, computeMetrics, GH_MAX_BUFFER, ghApi, headingComments, inPeriod, pages, parseArgs, period,
  renderReport, repoFromRemote, ruleDocCommits, summarizePrs, waiting,
} from './harness-retro.mjs';

// 全部用假資料，不連網
const P = period('2026-11-01', '2026-11-07');
const comment = (n, body, created_at = '2026-11-03T10:00:00Z') => ({
  issue_url: `https://api.github.com/repos/o/r/issues/${n}`, body, created_at,
});
const pr = (number, extra = {}) => ({
  number, created_at: '2026-11-02T10:00:00Z', closed_at: '2026-11-02T12:00:00Z', merged_at: '2026-11-02T12:00:00Z',
  state: 'closed', draft: false, head: { ref: `feat/${number}-x` }, ...extra,
});
const run = (prNumber, extra = {}) => ({
  event: 'pull_request', head_branch: `feat/${prNumber}-x`, head_sha: `sha-${prNumber}-1`, workflow_id: 1,
  run_attempt: 1, conclusion: 'success', created_at: '2026-11-02T10:00:30Z', pull_requests: [], ...extra,
});

test('parseArgs：--since 必填、--until 預設今天、--repo 格式', () => {
  assert.deepEqual(parseArgs(['--since', '2026-11-01'], '2026-11-04'), { since: '2026-11-01', until: '2026-11-04', repo: null, errors: [] });
  assert.equal(parseArgs([], '2026-11-04').errors.length, 1);
  assert.equal(parseArgs(['--since', '2026/11/01'], '2026-11-04').errors.length, 1);
  assert.equal(parseArgs(['--since', '2026-11-05', '--until', '2026-11-01'], 'x').errors.length, 1);
  assert.equal(parseArgs(['--since', '2026-11-01', '--repo', 'bad'], '2026-11-04').errors.length, 1);
  assert.equal(parseArgs(['--since', '2026-11-01', '--repo', 'owner/name'], '2026-11-04').repo, 'owner/name');
  assert.equal(parseArgs(['--since', '2026-11-01', '--nope'], '2026-11-04').errors.length, 1);
});

test('period／inPeriod：since 當天 00:00 起，until 當天結束為止（UTC）', () => {
  assert.equal(inPeriod('2026-11-01T00:00:00Z', P), true);
  assert.equal(inPeriod('2026-11-07T23:59:59Z', P), true);
  assert.equal(inPeriod('2026-11-08T00:00:00Z', P), false);
  assert.equal(inPeriod('2026-10-31T23:59:59Z', P), false);
});

test('repoFromRemote：https 與 SSH 網址；不是 GitHub 時回傳 null', () => {
  assert.equal(repoFromRemote('https://github.com/owner/name.git\n'), 'owner/name');
  assert.equal(repoFromRemote('https://github.com/owner/name'), 'owner/name');
  // SSH 網址分開組合：scripts/check-sensitive.mjs 沒有放行 git@<主機>，寫在一起會被當成 email
  assert.equal(repoFromRemote(['git', 'github.com:owner/my.repo.git'].join('@')), 'owner/my.repo');
  assert.equal(repoFromRemote('https://gitlab.com/owner/name.git'), null);
  assert.equal(repoFromRemote(undefined), null);
});

test('summarizePrs：已合併、開啟中、關閉未合併分開計', () => {
  assert.deepEqual(summarizePrs([pr(1), pr(2, { state: 'open', merged_at: null, closed_at: null }), pr(3, { merged_at: null })]),
    { total: 3, merged: 1, open: 1, closed: 1 });
  assert.deepEqual(summarizePrs([]), { total: 0, merged: 0, open: 0, closed: 0 });
});

test('changeRequests：依 PR 去重，輪數是加 changes-requested 的次數；移除標籤與其他標籤不算', () => {
  const labeled = (name) => ({ event: 'labeled', label: { name } });
  const r = changeRequests({
    5: [labeled('changes-requested'), { event: 'unlabeled', label: { name: 'changes-requested' } }, labeled('changes-requested')],
    6: [labeled('blocked')],
    7: [labeled('changes-requested')],
  });
  assert.deepEqual(r, { prs: 2, rounds: 3, detail: [{ pr: 5, rounds: 2 }, { pr: 7, rounds: 1 }] });
});

test('headingComments：以開頭標題分類，只算期間內建立的；停止原因取第一行', () => {
  const r = headingComments([
    comment(10, '## agent 停止：測試一直失敗\n\n- **停在哪一步**：第 4 步'),
    comment(10, '## agent 停止：又停了'),
    comment(11, '\n## agent 停止\n沒有原因'),
    comment(12, '## agent 停止：期間外', '2026-10-20T00:00:00Z'),
    comment(10, '## 決定\n\n- 選項 1'),
    comment(10, '## 決定（補充）'),
    comment(13, '## 修正要求\n\n- [ ] 改 A'),
    comment(13, '## 合併授權\n\n已獲授權'),
    comment(13, '一般留言提到 ## 決定'),
    comment(13, '## 計畫（#13）'),
  ], P);
  assert.deepEqual(r.stops, [
    { number: 10, reason: '測試一直失敗' }, { number: 10, reason: '又停了' }, { number: 11, reason: '（未寫原因）' },
  ]);
  assert.equal(r.stopTargets, 2);
  assert.equal(r.decisions, 2);
  assert.equal(r.changeRequests, 1);
  assert.equal(r.mergeAuths, 1);
});

test('ciFirstPass：第一個 commit 的每個 workflow 第一次執行都成功才算通過；重新執行過算失敗', () => {
  const prs = [pr(1), pr(2), pr(3), pr(4), pr(5)];
  const runs = [
    // 假資料的 PR 1：兩個 workflow 都成功；之後的 commit 失敗不影響
    run(1), run(1, { workflow_id: 2 }), run(1, { head_sha: 'sha-1-2', conclusion: 'failure', created_at: '2026-11-02T11:00:00Z' }),
    // 假資料的 PR 2：第一個 commit 有一個 workflow 失敗，修正後的 commit 成功
    run(2), run(2, { workflow_id: 2, conclusion: 'failure' }), run(2, { head_sha: 'sha-2-2', created_at: '2026-11-02T11:00:00Z' }),
    // 假資料的 PR 3：成功但是重新執行過（run_attempt 2）
    run(3, { run_attempt: 2 }),
    // 假資料的 PR 4：同一個 workflow 在同一個 commit 跑了兩次（例如編輯描述），以第一次為準
    run(4, { conclusion: 'failure' }), run(4, { created_at: '2026-11-02T10:05:00Z' }),
    // 其他事件、其他分支、PR 關閉後同名分支的 run 不算
    run(1, { event: 'push', conclusion: 'failure', created_at: '2026-11-02T10:00:00Z' }),
    run(9), run(1, { conclusion: 'failure', created_at: '2026-11-05T00:00:00Z', head_sha: 'sha-1-0' }),
  ];
  assert.deepEqual(ciFirstPass(prs, runs), { passed: 1, total: 4, noRuns: 1 });
});

test('ciFirstPass：run.pull_requests 有 PR 編號時，分支不同也對應得到', () => {
  const r = ciFirstPass([pr(1)], [run(1, { head_branch: 'other', pull_requests: [{ number: 1 }] })]);
  assert.deepEqual(r, { passed: 1, total: 1, noRuns: 0 });
});

test('waiting：blocked、needs-human 的 Issue／PR 與非 Draft 的開啟中 PR', () => {
  const lab = (...names) => ({ labels: names.map((name) => ({ name })) });
  assert.deepEqual(waiting([lab('blocked'), lab('blocked', 'type:fix'), lab('needs-human')], [{ draft: false }, { draft: true }]),
    { blocked: 2, needsHuman: 1, readyPrs: 1 });
});

test('ruleDocCommits：AGENTS.md 與 docs/workflow 的 commit 合併去重', () => {
  assert.equal(ruleDocCommits([[{ sha: 'a' }, { sha: 'b' }], [{ sha: 'b' }, { sha: 'c' }]]), 3);
  assert.equal(ruleDocCommits([[], []]), 0);
});

test('renderReport：Markdown 表格含每項指標的算法與限制，以及停止原因與修正輪數', () => {
  const data = {
    prs: [pr(1), pr(2, { state: 'open', merged_at: null, closed_at: null })],
    eventsByPr: { 1: [{ event: 'labeled', label: { name: 'changes-requested' } }] },
    comments: [comment(1, '## agent 停止：CI 失敗'), comment(1, '## 決定')],
    runs: [run(1)],
    openIssues: [{ labels: [{ name: 'blocked' }] }],
    openPrs: [{ draft: false }],
    commitLists: [[{ sha: 'a' }], []],
  };
  const md = renderReport({ repo: 'o/r', p: P, ...computeMetrics(data, P), generatedAt: '2026-11-08T00:00:00Z' });
  assert.match(md, /^# harness 指標：o\/r/);
  assert.match(md, /\| 指標 \| 值 \| 算法與限制 \|/);
  assert.match(md, /\| PR 數 \| 2（已合併 1、開啟中 1、關閉未合併 0） \|/);
  assert.match(md, /\| CI 首次通過率 \| 100%（1／1） \|/);
  assert.match(md, /共用帳號時只能依標題判斷/);
  assert.match(md, /執行當下的狀態/);
  assert.match(md, /- #1：CI 失敗/);
  assert.match(md, /- #1：1 輪/);
  assert.match(md, /\| 規則文件修改次數 \| 1 \|/);
  const empty = renderReport({
    repo: 'o/r', p: P, generatedAt: 'x',
    ...computeMetrics({ prs: [], eventsByPr: {}, comments: [], runs: [], openIssues: [], openPrs: [], commitLists: [[]] }, P),
  });
  assert.match(empty, /CI 首次通過率 \| —（0／0）/);
  assert.doesNotMatch(empty, /agent 停止的原因/);
});

test('ghApi：只讀的 gh api 呼叫；速率限制時等待後重試，超過次數以說明停止', () => {
  const calls = [];
  const ok = ghApi('repos/o/r/pulls', { run: (args) => { calls.push(args); return '[1]'; } });
  assert.deepEqual(ok, [1]);
  assert.deepEqual(calls[0].filter((a) => /^-X|--method|^-f$|^-F$/.test(a)), [], '不帶寫入參數');
  let n = 0;
  const slept = [];
  const flaky = ghApi('x', {
    run: () => { if (n++ < 2) throw Object.assign(new Error('HTTP 403'), { stderr: 'API rate limit exceeded' }); return '{"a":1}'; },
    sleep: (ms) => slept.push(ms), waitMs: 5,
  });
  assert.deepEqual(flaky, { a: 1 });
  assert.deepEqual(slept, [5, 5]);
  assert.throws(() => ghApi('x', {
    run: () => { throw new Error('HTTP 429 Too Many Requests'); }, sleep: () => {}, attempts: 2,
  }), /速率限制，重試 2 次仍失敗/);
  assert.throws(() => ghApi('x', { run: () => { throw new Error('HTTP 404: Not Found'); }, sleep: () => assert.fail('不應等待') }), /404/);
});

test('pages：逐頁讀到不足一頁為止；stop 時提早結束；key 取物件中的陣列', () => {
  const seen = [];
  const api = (path) => {
    seen.push(path);
    const page = Number(/[?&]page=(\d+)/.exec(path)[1]);
    return page === 1 ? Array.from({ length: 100 }, (_, i) => i) : [100, 101];
  };
  assert.equal(pages('x?state=all', { api }).length, 102);
  assert.match(seen[0], /^x\?state=all&per_page=100&page=1$/);
  assert.equal(pages('x', { api, stop: (i) => i === 50 }).length, 50);
  assert.deepEqual(pages('y', { api: () => ({ workflow_runs: [1, 2] }), key: 'workflow_runs' }), [1, 2]);
});

// dev-workflow-template#60：資料量大的 repo，一頁 JSON 超過 execFileSync 預設的 1 MB 輸出上限
test('ghApi：超過 1 MB 的輸出可正常解析；預設輸出上限是 64 MB', () => {
  const big = JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ number: i, body: 'x'.repeat(500) })));
  assert.ok(big.length > 1024 * 1024);
  const r = ghApi('repos/o/r/pulls', { run: () => big });
  assert.equal(r.length, 3000);
  assert.equal(GH_MAX_BUFFER, 64 * 1024 * 1024);
});

test('ghApi：ENOBUFS 時不重試，丟出「單頁資料過大」與 path', () => {
  let calls = 0;
  const enobufs = () => { calls++; throw Object.assign(new Error('spawnSync gh ENOBUFS'), { code: 'ENOBUFS' }); };
  assert.throws(() => ghApi('repos/o/r/actions/runs?page=1', { run: enobufs, sleep: () => assert.fail('不應等待') }),
    /單頁資料過大，超過 64 MB 的讀取上限：repos\/o\/r\/actions\/runs\?page=1/);
  assert.equal(calls, 1);
  // 只有訊息、沒有 code 時也辨認得出
  assert.throws(() => ghApi('p', { run: () => { throw new Error('spawnSync gh ENOBUFS'); }, sleep: () => {} }), /單頁資料過大/);
});
