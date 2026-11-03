import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sensitive from '../../scripts/check-sensitive.mjs';
import { checkContent, checkPostBody, checkSensitiveContent, checkSource, KINDS, MANUAL_MAX_AGE_MS } from './check-post-body.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'check-post-body.mjs');
const ok = (body, issue, kind) => assert.deepEqual(checkContent(body, { issue, kind }), [], `應通過：${body}`);
const ng = (body, issue, kind) => assert.notDeepEqual(checkContent(body, { issue, kind }), [], `應拒絕：${body}`);

test('checkContent：PR 描述要有 Closes／Refs 本 Issue', () => {
  ok('## 為什麼\n\nCloses #104\n', 104, 'pr');
  ok('Refs #104', 104, 'pr');
  ng('Closes #999', 104, 'pr');
  ng('Closes #1040', 104, 'pr');
  ng('見 #104', 104, 'pr');
  ng('`Closes #104`', 104, 'pr');
  ng('<!-- Closes #104 -->', 104, 'pr');
  assert.match(checkContent('Closes #999', { issue: 104, kind: 'pr' })[0], /#999/);
});

test('checkContent：留言的開頭標題與 Issue 編號', () => {
  ok('## 計畫（#104）\n\n內容', 104, 'plan');
  ok('\n## agent 停止：測試失敗\n\n- Issue：#104', 104, 'stop');
  ok('## 修正回報（#104）\n\n- ✅ 已完成', 104, 'fix');
  ok('## 合併後待辦（#104）\n\n- [ ] 確認', 104, 'todo');
  ng('## 計畫\n\n內容', 104, 'plan');
  ng('## 計畫（#1041）', 104, 'plan');
  ng('計畫（#104）', 104, 'plan');
  ng('## agent 停止（#104）', 104, 'plan');
  ng('## 計畫 `#104`', 104, 'plan');
  ng('', 104, 'stop');
});

test('checkSource：runner 執行時檔案必須在 KK_RUN_TMP 底下、不是舊檔，不接受標準輸入', () => {
  const runTmp = join(tmpdir(), 'kk', '.runner-tmp', '20261102-104');
  const started = Date.parse('2026-11-02T10:00:00Z');
  const base = { runTmp, startedMs: started, mtimeMs: started + 5e3, nowMs: started + 10e3 };
  assert.deepEqual(checkSource({ ...base, file: join(runTmp, 'pr.md') }), []);
  assert.deepEqual(checkSource({ ...base, file: join(runTmp, 'sub', 'pr.md') }), []);
  assert.equal(checkSource({ ...base, file: join(tmpdir(), 'pr.md') }).length, 1);
  assert.equal(checkSource({ ...base, file: join(runTmp, '..', 'pr.md') }).length, 1);
  assert.equal(checkSource({ ...base, file: `${runTmp}-x/pr.md` }).length, 1);
  assert.equal(checkSource({ ...base, file: join(runTmp, 'pr.md'), mtimeMs: started - 60e3 }).length, 1);
  assert.equal(checkSource({ ...base, file: '-' }).length, 1);
});

test('checkSource：手動執行時標準輸入可用；檔案超過 30 分鐘視為舊檔', () => {
  const now = Date.parse('2026-11-02T10:00:00Z');
  assert.deepEqual(checkSource({ file: '-', runTmp: null, startedMs: NaN, nowMs: now }), []);
  assert.deepEqual(checkSource({ file: 'a.md', runTmp: null, startedMs: NaN, mtimeMs: now - 60e3, nowMs: now }), []);
  assert.equal(checkSource({ file: 'a.md', runTmp: null, startedMs: NaN, mtimeMs: now - MANUAL_MAX_AGE_MS - 1, nowMs: now }).length, 1);
});

test('checkPostBody：參數錯誤時列出原因', () => {
  const r = checkPostBody(['--kind', 'x'], {});
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3);
  assert.deepEqual(KINDS, ['pr', 'plan', 'stop', 'fix', 'todo']);
});

// 測試資料以字串組合產生，本檔不寫出真實格式的 email 與個人路徑（#124）
const userPath = ['', 'Users', 'someone', 'Projects', 'kit'].join('/');
const homePath = ['', 'home', 'someone', 'kit'].join('/');
const email = ['someone', 'mail.com'].join('@');

test('checkSensitiveContent：個人路徑與 email 拒絕，只列行號與種類', () => {
  const body = `## 為什麼\n\n路徑是 ${userPath}\n聯絡 ${email}\n${homePath}/x 與 ${email}\n`;
  const errors = checkSensitiveContent(body);
  assert.deepEqual(errors, ['第 3 行：個人路徑', '第 4 行：email', '第 5 行：email', '第 5 行：個人路徑']);
  for (const e of errors) {
    for (const hit of [userPath, homePath, email, 'someone']) assert.ok(!e.includes(hit), `輸出含命中文字：${e}`);
  }
});

test('checkSensitiveContent：程式碼區塊、行內程式碼與 HTML 註解也檢查', () => {
  assert.deepEqual(checkSensitiveContent(`說明\n\n\`\`\`bash\ncd ${userPath}\n\`\`\`\n`), ['第 4 行：個人路徑']);
  assert.deepEqual(checkSensitiveContent(`見 \`${email}\``), ['第 1 行：email']);
  assert.deepEqual(checkSensitiveContent(`<!-- ${homePath} -->`), ['第 1 行：個人路徑']);
});

test('checkSensitiveContent：/home/runner、保留網域、noreply 與佔位寫法通過', () => {
  const body = [
    'CI 的路徑 /home/runner/work/kit/kit',
    '`/Users/<名稱>/Projects`、/home/<名稱>、~/Projects、/opt/homebrew/bin/gh',
    'user@example.com、a@b.test、someone@x.tld',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    '12345+someone@users.noreply.github.com',
    'npm i pkg@1.2.3',
  ].join('\n');
  assert.deepEqual(checkSensitiveContent(body), []);
});

test('checkSensitiveContent：與 scripts/check-sensitive.mjs 的規則一致', () => {
  const samples = [userPath, homePath, '/home/runner/work', ['', 'home', 'runner2'].join('/'), '/Users/<名稱>',
    email, 'user@example.com', 'noreply@anthropic.com', 'a@b.test', 'pkg@1.2.3', `${email} ${userPath}`];
  for (const text of samples) {
    const expected = [];
    if (sensitive.scanText(text, null).length) expected.push('第 1 行：email');
    if (sensitive.scanPost(text, null).some((f) => f.kind === 'path')) expected.push('第 1 行：個人路徑');
    assert.deepEqual(checkSensitiveContent(text), expected, text);
  }
});

// 重現 #104：另一個專案在共用的暫存資料夾留下同名檔案，本次的寫入失敗，agent 沿用了舊檔
test('重現：其他專案留下的同名暫存檔不會通過檢查', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'kk-check-post-body-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const shared = join(root, 'shared-tmp');
  const runTmp = join(root, 'worktree', '.runner-tmp', '20261102T100000-104');
  mkdirSync(shared, { recursive: true });
  mkdirSync(runTmp, { recursive: true });
  const started = new Date(Date.now() - 60e3);
  const old = new Date(started.getTime() - 3600e3);
  const env = { KK_RUN_TMP: runTmp, KK_RUN_STARTED: started.toISOString() };
  const run = (args, e = env, input) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...e }, encoding: 'utf8', input });

  // 其他專案的檔案：別的 Issue 編號，修改時間較早
  const other = join(shared, 'body.md');
  writeFileSync(other, '## 為什麼\n\n其他專案的內容\n\nCloses #999\n');
  utimesSync(other, old, old);
  let r = run(['--issue', '104', '--kind', 'pr', other]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /不要貼出/);
  assert.match(r.stderr, /KK_RUN_TMP/);

  // 內容剛好正確的舊檔也拒絕
  const lookalike = join(shared, 'plan.md');
  writeFileSync(lookalike, '## 計畫（#104）\n\n舊的內容\n');
  utimesSync(lookalike, old, old);
  assert.equal(run(['--issue', '104', '--kind', 'plan', lookalike]).status, 1);

  // 同名檔被複製進本次的資料夾但修改時間較早，仍拒絕
  const copied = join(runTmp, 'body.md');
  writeFileSync(copied, '## 為什麼\n\nCloses #104\n');
  utimesSync(copied, old, old);
  r = run(['--issue', '104', '--kind', 'pr', copied]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /舊檔/);

  // runner 執行時不接受標準輸入
  assert.equal(run(['--issue', '104', '--kind', 'pr', '-'], env, 'Closes #104\n').status, 1);

  // 本次寫入 KK_RUN_TMP 的新檔通過；通過的檔案就是 gh --body-file 要貼出的同一個路徑
  const fresh = join(runTmp, 'pr-104.md');
  const content = '## 為什麼\n\n本次的內容\n\nCloses #104\n';
  writeFileSync(fresh, content);
  r = run(['--issue', '104', '--kind', 'pr', fresh]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(fresh, 'utf8'), content);

  // 內容有個人路徑或 email 時拒絕，輸出不含命中的文字（#124）
  const leaky = join(runTmp, 'pr-124.md');
  writeFileSync(leaky, `## 為什麼\n\nCloses #104\n\n\`\`\`\n${userPath}\n${email}\n\`\`\`\n`);
  r = run(['--issue', '104', '--kind', 'pr', leaky]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /第 6 行：個人路徑/);
  assert.match(r.stderr, /第 7 行：email/);
  for (const hit of [userPath, email]) assert.ok(!`${r.stdout}${r.stderr}`.includes(hit));

  // 手動執行（沒有 KK_RUN_TMP）：標準輸入可用，舊檔仍拒絕
  assert.equal(run(['--issue', '104', '--kind', 'pr', '-'], {}, 'Closes #104\n').status, 0);
  assert.equal(run(['--issue', '104', '--kind', 'pr', other], {}).status, 1);
});

// 流程說明：agent-workflow.md 中每個 gh … --body-file <路徑>，前面都有以同一個路徑執行的 check-post-body.mjs
test('agent-workflow.md：貼出的檔案就是檢查通過的檔案', () => {
  const doc = readFileSync(join(HERE, '..', '..', 'docs', 'workflow', 'agent-workflow.md'), 'utf8');
  const blocks = [...doc.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1].split('\n').map((l) => l.trim()));
  let posts = 0;
  for (const lines of blocks) {
    lines.forEach((line, i) => {
      const m = /^gh (?:pr create|pr comment|issue comment)\b.*--body-file (\S+)/.exec(line);
      if (!m) return;
      posts++;
      assert.notEqual(m[1], '-', `不用標準輸入：${line}`);
      const checks = lines.slice(0, i).filter((l) => l.startsWith('node tools/workflow/check-post-body.mjs '));
      assert.ok(checks.some((l) => l.endsWith(` ${m[1]}`)), `貼出前沒有檢查同一個檔案：${line}`);
    });
  }
  assert.ok(posts >= 3, `應至少有 PR 描述、人工待辦與停止回報三處貼出（找到 ${posts}）`);
  assert.match(doc, /寫入失敗時不執行 `gh`/);
});
