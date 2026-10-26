import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPrBody, parseLabels } from './check-pr-body.mjs';

const passes = (body, labels = []) =>
  assert.equal(checkPrBody(body, labels).ok, true, `應通過：${JSON.stringify(body)}`);
const fails = (body, labels = []) =>
  assert.equal(checkPrBody(body, labels).ok, false, `應失敗：${JSON.stringify(body)}`);

test('Closes／Refs 加 Issue 編號時通過', () => {
  passes('Closes #12');
  passes('refs #3');
  passes('## 為什麼\n\nREFS: #7\n');
});

test('GitHub 的 close／fix／resolve 關鍵字變化都通過', () => {
  for (const word of ['close', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved']) {
    passes(`${word} #5`);
  }
});

test('只有 fast-lane 標籤時通過', () => {
  passes('', ['fast-lane']);
  passes('修正錯字', ['type:docs', 'fast-lane']);
});

test('PR 範本未填的 Closes # 失敗', () => {
  fails('## 為什麼\n\nCloses #\n\n## 變更內容\n');
});

test('空白本文失敗', () => {
  fails('');
  fails('   \n');
  fails(null);
});

test('沒有關鍵字或只有編號時失敗', () => {
  fails('見 #12');
  fails('Closes 12');
  fails('closes#12');
  fails('Closes #12abc');
});

test('HTML 註解中的關鍵字不算', () => {
  fails('<!-- Closes #12 -->\n## 為什麼\n');
});

test('程式碼區塊與行內程式碼中的關鍵字不算', () => {
  fails("執行 `PR_BODY='Closes #1' node check-pr-body.mjs`");
  fails('```\nCloses #12\n```');
  passes('Closes #2\n\n執行 `Refs #1`');
});

test('失敗時有一句說明，通過時也有說明', () => {
  assert.match(checkPrBody('', []).message, /Closes #N/);
  assert.ok(checkPrBody('Closes #1', []).message);
});

test('parseLabels 接受 JSON 陣列、逗號分隔或空值', () => {
  assert.deepEqual(parseLabels('["fast-lane","type:docs"]'), ['fast-lane', 'type:docs']);
  assert.deepEqual(parseLabels('fast-lane, type:docs'), ['fast-lane', 'type:docs']);
  assert.deepEqual(parseLabels(''), []);
  assert.deepEqual(parseLabels(undefined), []);
});

const script = fileURLToPath(new URL('./check-pr-body.mjs', import.meta.url));
const run = (env) =>
  spawnSync(process.execPath, [script], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });

test('指令：通過時 exit 0', () => {
  const r = run({ PR_BODY: 'Closes #12', PR_LABELS: '[]' });
  assert.equal(r.status, 0);
});

test('指令：失敗時 exit 1 並輸出說明', () => {
  const r = run({ PR_BODY: 'Closes #', PR_LABELS: '[]' });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /Closes #N/);
});

test('指令：本文中的 shell 字元只當文字處理', () => {
  const r = run({ PR_BODY: '$(touch /tmp/x) `id` Refs #4', PR_LABELS: '[]' });
  assert.equal(r.status, 0);
});
