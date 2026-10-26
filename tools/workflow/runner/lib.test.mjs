import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  advanceAwake, agentNote, buildSettings, canStartNew, countOpenPrs, hasDecision, inHours, latestStart,
  linkedIssue, lockIsActive, needsWipSave, orderWork, pickWork, shouldContinue, staleWorking, stopReportBody,
  validateConfig, wipBranchName,
} from './lib.mjs';

const ME = 'me';
const opts = { account: ME, skipBranchPrefixes: ['codex/'] };
const c = (body, createdAt, authorAssociation = 'OWNER') => ({ body, createdAt, authorAssociation });
const pr = (number, issue, extra = {}) => ({
  number, title: `PR ${number}`, body: issue ? `Closes #${issue}` : '說明', headRefName: `feat/${number}-x`,
  labels: [], comments: [], author: { login: ME }, ...extra,
});
const issue = (number, extra = {}) => ({ number, title: `Issue ${number}`, labels: [], comments: [], ...extra });
const kinds = (r) => r.candidates.map((w) => `${w.kind}:${w.issue}`);

test('linkedIssue：Closes／Refs 與 GitHub 關鍵字變化', () => {
  assert.equal(linkedIssue('Closes #12'), 12);
  assert.equal(linkedIssue('說明\nrefs: #3'), 3);
  assert.equal(linkedIssue('Fixed #8'), 8);
  assert.equal(linkedIssue('Closes #'), null);
  assert.equal(linkedIssue(null), null);
});

test('hasDecision：決定晚於最後一次停止才算', () => {
  assert.equal(hasDecision([c('## agent 停止：x', '2026-01-01T00:00Z'), c('## 決定\n選項 1', '2026-01-01T01:00Z')]), true);
  assert.equal(hasDecision([c('## 決定', '2026-01-01T00:00Z'), c('## agent 停止：x', '2026-01-01T01:00Z')]), false);
  assert.equal(hasDecision([c('## agent 停止：x', '2026-01-01T00:00Z')]), false);
  assert.equal(hasDecision([c('## 決定', '2026-01-01T00:00Z')]), false, '沒有停止回報時不算');
  assert.equal(hasDecision([]), false);
});

test('hasDecision：多次停止與決定交錯，以最後一次為準', () => {
  const cs = [
    c('## agent 停止：a', '2026-01-01T00:00Z'), c('## 決定', '2026-01-01T01:00Z'),
    c('## agent 停止：b', '2026-01-01T02:00Z'),
  ];
  assert.equal(hasDecision(cs), false);
  assert.equal(hasDecision([...cs, c('## 決定', '2026-01-01T03:00Z')]), true);
});

test('hasDecision：plan-first 的「## 計畫」也算停止；前置空白可接受；其他標題不算', () => {
  assert.equal(hasDecision([c('## 計畫\n…', '2026-01-01T00:00Z'), c('  \n## 決定', '2026-01-01T01:00Z')]), true);
  assert.equal(hasDecision([c('## agent 停止', '2026-01-01T00:00Z'), c('同意。## 決定', '2026-01-01T01:00Z')]), false);
});

const decided = [c('## agent 停止：x', '2026-01-01T00:00Z'), c('## 決定', '2026-01-01T01:00Z')];

test('hasDecision：只採信 OWNER／MEMBER／COLLABORATOR 寫的決定', () => {
  const stop = c('## agent 停止：x', '2026-01-01T00:00Z');
  assert.equal(hasDecision([stop, c('## 決定', '2026-01-01T01:00Z', 'NONE')]), false, '外部使用者的決定不算');
  assert.equal(hasDecision([stop, c('## 決定', '2026-01-01T01:00Z', 'CONTRIBUTOR')]), false);
  assert.equal(hasDecision([stop, c('## 決定', '2026-01-01T01:00Z', 'COLLABORATOR')]), true, '協作者的決定算');
  assert.equal(hasDecision([stop, c('## 決定', '2026-01-01T01:00Z', 'MEMBER')]), true);
  assert.equal(hasDecision([stop, { body: '## 決定', createdAt: '2026-01-01T01:00Z' }]), false, '缺少 authorAssociation 時不算');
  assert.equal(hasDecision([c('## agent 停止：x', '2026-01-01T00:00Z', 'NONE'), c('## 決定', '2026-01-01T01:00Z')]), true, '停止回報不限制身分');
  assert.equal(
    hasDecision([stop, c('## 決定', '2026-01-01T01:00Z'), c('## agent 停止：y', '2026-01-01T02:00Z'), c('## 決定', '2026-01-01T03:00Z', 'NONE')]),
    false, '最後一次停止之後只有外部的決定',
  );
});

test('orderWork：修正模式 → 依決定繼續 → 新工作（最舊的先做）', () => {
  const r = orderWork({
    fixPrs: [pr(20, 5)],
    blockedIssues: [issue(6, { comments: decided })],
    blockedPrs: [pr(21, 7, { comments: decided })],
    readyIssues: [
      issue(9, { createdAt: '2026-01-03T00:00Z' }),
      issue(8, { createdAt: '2026-01-02T00:00Z' }),
    ],
  }, opts);
  assert.deepEqual(kinds(r), ['修正模式:5', '依決定繼續:6', '依決定繼續:7', '新工作:8', '新工作:9']);
  assert.deepEqual(r.candidates.map((w) => w.isNew), [false, false, false, true, true]);
});

test('orderWork：PR 一律換成對應的 Issue（agent:working 加在 Issue）', () => {
  const r = orderWork({ fixPrs: [pr(20, 5)] }, opts);
  assert.equal(r.candidates[0].issue, 5);
  assert.equal(r.candidates[0].ref, 'PR #20');
});

test('orderWork：PR 找不到 Issue 時略過並說明', () => {
  const r = orderWork({ fixPrs: [pr(20, null)] }, opts);
  assert.equal(r.candidates.length, 0);
  assert.match(r.skipped[0], /PR #20/);
});

test('orderWork：略過的分支前綴、他人的 PR、blocked 但沒有決定的 PR', () => {
  const r = orderWork({
    fixPrs: [
      pr(20, 5, { headRefName: 'codex/5-x' }),
      pr(21, 6, { author: { login: 'someone' } }),
      pr(22, 7, { labels: [{ name: 'blocked' }] }),
      pr(23, 8, { labels: [{ name: 'blocked' }], comments: decided }),
    ],
  }, opts);
  assert.deepEqual(kinds(r), ['修正模式:8']);
});

test('orderWork：blocked 沒有決定的 Issue 不接；agent:ready 帶 working／blocked 不接', () => {
  const r = orderWork({
    blockedIssues: [issue(6, { comments: [c('## agent 停止', '2026-01-01T00:00Z')] })],
    readyIssues: [
      issue(8, { createdAt: '2026-01-01T00:00Z', labels: [{ name: 'agent:working' }] }),
      issue(9, { createdAt: '2026-01-01T00:00Z', labels: [{ name: 'blocked' }] }),
      issue(10, { createdAt: '2026-01-01T00:00Z' }),
    ],
  }, opts);
  assert.deepEqual(kinds(r), ['新工作:10']);
});

test('orderWork：同一張 Issue 只出現一次（保留較優先的）', () => {
  const r = orderWork({
    fixPrs: [pr(20, 5)],
    blockedIssues: [issue(5, { comments: decided })],
    readyIssues: [issue(5, { createdAt: '2026-01-01T00:00Z' })],
  }, opts);
  assert.deepEqual(kinds(r), ['修正模式:5']);
});

test('orderWork：排除本次已處理的 Issue（連續處理不重複）', () => {
  const r = orderWork({
    fixPrs: [pr(20, 5)],
    readyIssues: [issue(8, { createdAt: '2026-01-01T00:00Z' }), issue(9, { createdAt: '2026-01-02T00:00Z' })],
  }, { ...opts, exclude: new Set([5, 8]) });
  assert.deepEqual(kinds(r), ['新工作:9']);
});

test('countOpenPrs：只算自己的、非 Draft、非略過前綴', () => {
  const prs = [
    pr(1, 1), pr(2, 2, { isDraft: true }), pr(3, 3, { headRefName: 'codex/3' }),
    pr(4, 4, { author: { login: 'someone' } }), pr(5, 5),
  ];
  assert.equal(countOpenPrs(prs, opts), 2);
});

test('pickWork：新工作在待審 PR 低於上限時才接', () => {
  const fresh = [{ kind: '新工作', issue: 1, isNew: true }];
  assert.equal(pickWork(fresh, { openPrs: 2, maxOpenPrs: 3 }).pick.issue, 1);
  const atLimit = pickWork(fresh, { openPrs: 3, maxOpenPrs: 3 });
  assert.equal(atLimit.pick, null);
  assert.match(atLimit.reason, /上限 3/);
  assert.equal(pickWork(fresh, { openPrs: 5, maxOpenPrs: 3 }).pick, null);
});

test('pickWork：修正模式與依決定繼續不受上限限制；沒有候選時說明', () => {
  assert.equal(pickWork([{ kind: '修正模式', issue: 1, isNew: false }], { openPrs: 9, maxOpenPrs: 3 }).pick.issue, 1);
  assert.equal(pickWork([{ kind: '依決定繼續', issue: 2, isNew: false }], { openPrs: 9, maxOpenPrs: 3 }).pick.issue, 2);
  assert.match(pickWork([], { openPrs: 0, maxOpenPrs: 3 }).reason, /沒有待處理/);
});

test('inHours：[開始, 結束)', () => {
  const at = (h) => new Date(2026, 0, 1, h, 30);
  assert.equal(inHours(at(9), [9, 18]), true);
  assert.equal(inHours(at(17), [9, 18]), true);
  assert.equal(inHours(at(18), [9, 18]), false);
  assert.equal(inHours(at(8), [9, 18]), false);
});

const at = (h, m = 0) => new Date(2026, 0, 1, h, m);

test('latestStart／canStartNew：預設為執行時段結束減去 timeoutMinutes；有 lastStart 時用它', () => {
  const cfg = { hours: [9, 18], timeoutMinutes: 45 };
  assert.equal(latestStart(cfg), 17 * 60 + 15);
  assert.equal(canStartNew(at(17, 15), cfg), true);
  assert.equal(canStartNew(at(17, 16), cfg), false);
  const withLast = { ...cfg, lastStart: [16, 30] };
  assert.equal(latestStart(withLast), 16 * 60 + 30);
  assert.equal(canStartNew(at(16, 30), withLast), true);
  assert.equal(canStartNew(at(16, 31), withLast), false);
});

test('advanceAwake：正常累計；間隔超過 2 分鐘視為休眠，只算 30 秒', () => {
  const t0 = 1_000_000;
  assert.deepEqual(advanceAwake({ awakeMs: 0, lastTick: t0 }, t0 + 30e3), { awakeMs: 30e3, lastTick: t0 + 30e3, sleptMs: 0 });
  assert.deepEqual(advanceAwake({ awakeMs: 60e3, lastTick: t0 }, t0 + 120e3), { awakeMs: 180e3, lastTick: t0 + 120e3, sleptMs: 0 }, '恰好 2 分鐘仍算醒著');
  assert.deepEqual(advanceAwake({ awakeMs: 60e3, lastTick: t0 }, t0 + 3600e3), { awakeMs: 90e3, lastTick: t0 + 3600e3, sleptMs: 3570e3 });
});

test('shouldContinue：各停止條件', () => {
  const cfg = { hours: [9, 18], timeoutMinutes: 45 };
  const base = { now: at(10), config: cfg, processed: 1, paused: false, nowMode: false, lastResult: 'ok' };
  const reason = (patch) => shouldContinue({ ...base, ...patch }).reason;
  assert.deepEqual(shouldContinue(base), { go: true, reason: null });
  assert.equal(shouldContinue({ ...base, lastResult: 'ok' }).go, true, 'agent 自行停止（blocked）時 claude 正常結束，繼續');
  assert.match(reason({ lastResult: 'aborted' }), /非正常結束/);
  assert.match(reason({ lastResult: 'runner-error' }), /runner/);
  assert.match(reason({ nowMode: true }), /--now/);
  assert.match(reason({ paused: true }), /PAUSE/);
  assert.match(reason({ now: at(18) }), /執行時段/);
  assert.match(reason({ now: at(17, 30) }), /最晚開始/);
  assert.match(reason({ processed: 5 }), /maxPerRun（5）/, '預設 5');
  assert.equal(shouldContinue({ ...base, processed: 4 }).go, true);
  assert.match(reason({ processed: 2, config: { ...cfg, maxPerRun: 2 } }), /maxPerRun（2）/);
});

test('needsWipSave：有未提交的修改或未推送的 commit 才需要保存', () => {
  assert.equal(needsWipSave({ status: '', unpushed: 0 }), false);
  assert.equal(needsWipSave({ status: '\n', unpushed: 0 }), false);
  assert.equal(needsWipSave({ status: ' M a.js\n?? b.js', unpushed: 0 }), true);
  assert.equal(needsWipSave({ status: '', unpushed: 2 }), true);
});

test('wipBranchName：wip/<Issue>-<YYYYMMDD-HHmm>', () => {
  assert.equal(wipBranchName(30, new Date(2026, 9, 5, 7, 3)), 'wip/30-20261005-0703');
});

test('staleWorking：超過時間才算中斷', () => {
  const now = Date.parse('2026-01-01T10:00Z');
  const issues = [{ number: 1, updatedAt: '2026-01-01T07:00Z' }, { number: 2, updatedAt: '2026-01-01T09:00Z' }];
  assert.deepEqual(staleWorking(issues, now, 2).map((i) => i.number), [1]);
});

test('lockIsActive：pid 仍在執行才有效；內容無法解析時視為過期', () => {
  const alive = (pid) => pid === 100;
  assert.equal(lockIsActive('{"pid":100,"repo":"a/b"}', alive).active, true);
  assert.equal(lockIsActive('{"pid":200}', alive).active, false);
  assert.equal(lockIsActive('garbage', alive).active, false);
  assert.equal(lockIsActive('{}', alive).active, false);
});

const valid = {
  repo: 'owner/name', account: 'me', worktree: '../name-runner', hours: [9, 18],
  timeoutMinutes: 45, staleHours: 2, maxOpenPrs: 3,
};

test('validateConfig：完整設定沒有問題；範例設定檔也沒有問題', () => {
  assert.deepEqual(validateConfig(valid), []);
  assert.deepEqual(validateConfig({ ...valid, board: null }), []);
  const example = JSON.parse(readFileSync(new URL('./config.example.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateConfig(example), []);
});

test('validateConfig：一次列出所有缺少的必要欄位', () => {
  const errors = validateConfig({ repo: 'owner/name' });
  assert.equal(errors.length, 1);
  for (const k of ['account', 'worktree', 'hours', 'timeoutMinutes', 'staleHours', 'maxOpenPrs']) {
    assert.match(errors[0], new RegExp(k));
  }
  assert.deepEqual(validateConfig(null), ['設定檔必須是 JSON 物件']);
});

test('validateConfig：型別與範圍錯誤', () => {
  const bad = (patch, pattern) => assert.ok(validateConfig({ ...valid, ...patch }).some((e) => pattern.test(e)), JSON.stringify(patch));
  bad({ repo: 'name-only' }, /repo/);
  bad({ hours: [18, 9] }, /hours/);
  bad({ hours: [9, 25] }, /hours/);
  bad({ timeoutMinutes: 0 }, /timeoutMinutes/);
  bad({ maxOpenPrs: 1.5 }, /maxOpenPrs/);
  bad({ board: { owner: 'me' } }, /board/);
  bad({ extraAllow: 'Bash(x)' }, /extraAllow/);
  bad({ env: { A: 1 } }, /env/);
  bad({ maxPerRun: 0 }, /maxPerRun/);
  bad({ maxPerRun: 2.5 }, /maxPerRun/);
  bad({ lastStart: 17 }, /lastStart/);
  bad({ lastStart: [17, 60] }, /lastStart/);
  bad({ lastStart: [25, 0] }, /lastStart/);
  bad({ lastStart: [18, 1] }, /不能晚於/);
});

test('validateConfig：maxPerRun 與 lastStart 是選填', () => {
  assert.deepEqual(validateConfig({ ...valid, maxPerRun: 3, lastStart: [18, 0] }), []);
  assert.deepEqual(validateConfig({ ...valid, lastStart: [16, 30] }), []);
});

test('validateConfig：env 不能包含 API key（計費保護）', () => {
  const errors = validateConfig({ ...valid, env: { ANTHROPIC_API_KEY: 'x', ANTHROPIC_AUTH_TOKEN: 'y', OK: 'z' } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN/);
});

const base = JSON.parse(readFileSync(new URL('./runner-settings.base.json', import.meta.url), 'utf8'));
const settings = buildSettings(base, {
  repoRoot: '/work/repo',
  config: { ...valid, extraAllow: ['Bash(docker compose *)'], extraAllowedDomains: ['fonts.gstatic.com'], sandboxExcludedCommands: ['docker compose *'] },
});

test('buildSettings：加入專案路徑與額外設定，不修改共用設定', () => {
  assert.deepEqual(settings.sandbox.filesystem.allowWrite, ['/work/repo/.git', '~/.npm', '~/.cache']);
  assert.ok(settings.permissions.allow.includes('Bash(docker compose *)'));
  assert.ok(settings.sandbox.network.allowedDomains.includes('fonts.gstatic.com'));
  assert.deepEqual(settings.sandbox.excludedCommands, ['docker compose *']);
  assert.equal(base.sandbox.filesystem.allowWrite.includes('/work/repo/.git'), false);
  assert.equal(base.permissions.allow.includes('Bash(docker compose *)'), false);
  assert.deepEqual(settings.permissions.deny, base.permissions.deny);
});

test('共用設定：不含任何本機路徑；sandbox 開啟且不可用時不執行', () => {
  assert.doesNotMatch(JSON.stringify(base), /\/Users\/|\/home\//);
  assert.equal(base.sandbox.enabled, true);
  assert.equal(base.sandbox.failIfUnavailable, true);
  assert.equal(base.sandbox.allowUnsandboxedCommands, false);
});

test('buildSettings：決定要求的禁止規則都在', () => {
  for (const rule of [
    'Bash(gh api*merge*)', 'Bash(git reset --hard*)', 'Bash(git push* +main*)', 'Bash(git push*:main*)',
    'Bash(git push*refs/heads/main*)', 'Bash(git push*--delete*)', 'Bash(gh pr merge*)',
  ]) {
    assert.ok(settings.permissions.deny.includes(rule), rule);
  }
  assert.ok(settings.permissions.allow.includes('Bash(git push origin*)'));
});

// 以萬用字元近似 Claude Code 的權限比對：* 對應任意字元，整串比對。實際行為以 Claude Code 為準。
const toRegex = (rule) => {
  const m = /^Bash\((.*)\)$/.exec(rule);
  return m && new RegExp(`^${m[1].split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
};
const denyRx = settings.permissions.deny.map(toRegex).filter(Boolean);
const allowRx = settings.permissions.allow.map(toRegex).filter(Boolean);
const denied = (cmd) => denyRx.some((r) => r.test(cmd));
const allowed = (cmd) => !denied(cmd) && allowRx.some((r) => r.test(cmd));

test('權限比對：推到 main、刪除、強制推送、合併都被禁止', () => {
  for (const cmd of [
    'git push origin main', 'git push origin main --dry-run', 'git push --force-with-lease origin main',
    'git push origin HEAD:main', 'git push origin feat/1-x:main', 'git push origin +main', 'git push origin +HEAD:main',
    'git push origin HEAD:refs/heads/main', 'git push origin refs/heads/main', 'git push origin :main',
    'git push origin --delete feat/1-x', 'git push -d origin feat/1-x', 'git push --force origin feat/1-x',
    'git push -f origin feat/1-x', 'git push --mirror origin', 'git reset --hard origin/feat/1-x',
    'gh pr merge 3 --squash', 'gh api -X PUT repos/o/r/pulls/3/merge', 'gh api --method PUT repos/o/r/pulls/3/merge',
    'gh api repos/o/r/pulls/3/merge -X PUT', 'gh api graphql -f query=mutation{mergePullRequest(input:{})}',
    'gh api -X DELETE repos/o/r/issues/1', 'gh api repos/o/r/git/refs/heads/x --method DELETE',
    'gh pr checkout 3', 'rm -rf /', 'curl https://example.com',
  ]) {
    assert.equal(denied(cmd), true, `應禁止：${cmd}`);
  }
});

test('權限比對：agent 正常工作需要的指令都允許', () => {
  for (const cmd of [
    'git push origin feat/15-runner', 'git push origin HEAD:feat/15-runner',
    'git push --force-with-lease origin HEAD:feat/15-runner', 'git switch -c runner/feat/15-x origin/feat/15-x',
    'git fetch origin feat/15-x', 'git rebase origin/main', 'gh pr create --title t --body-file b.md',
    'gh issue edit 3 --remove-label blocked', 'gh api repos/o/r/issues/3/comments', 'npm test --prefix tools/workflow',
  ]) {
    assert.equal(allowed(cmd), true, `應允許：${cmd}`);
  }
});

test('agentNote：說明修正模式不用 reset，並附上專案的補充說明', () => {
  const note = agentNote({ agentNotes: ['先執行 docker compose up -d'] });
  assert.match(note, /runner\/<分支>/);
  assert.match(note, /git push origin HEAD:<分支>/);
  assert.match(note, /不要先 cd 再推送/);
  assert.match(note, /- 先執行 docker compose up -d$/);
});

test('agentNote：推送寫法只有一種；不啟動瀏覽器；時間上限用 Bash 工具的 timeout 參數', () => {
  const note = agentNote({});
  assert.equal(note.split('git push origin HEAD:<分支>').length - 1, 1, '推送寫法只出現一次');
  assert.doesNotMatch(note, /git push origin <分支>/);
  assert.match(note, /不自行啟動瀏覽器（Chrome、Playwright 等）/);
  assert.match(note, /人工待辦/);
  assert.match(note, /用 Bash 工具的 timeout 參數設定上限；不要在背景執行可能卡住的指令；不需要在 PR 回報/);
  assert.doesNotMatch(note, /perl|alarm/);
});

test('權限比對：perl -e alarm 不在允許清單（後面可接任何指令）', () => {
  assert.equal(allowed("perl -e 'alarm 120; exec @ARGV' -- git push origin main"), false);
});

test('stopReportBody：符合停止回報格式', () => {
  const body = stopReportBody({ step: '執行中', reason: '逾時', facts: 'x', account: 'me', logPath: 'logs/a.log' });
  assert.match(body, /^## agent 停止：逾時/);
  assert.match(body, /@me/);
  assert.match(body, /logs\/a\.log/);
});
