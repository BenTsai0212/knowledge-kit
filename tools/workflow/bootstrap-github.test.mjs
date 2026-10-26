import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONFIG_FILE, LABELS_FILE, formatCommand, labelCommand, parseArgs, parseGhJson, parseLabels, planLabels, run,
} from './bootstrap-github.mjs';

const realLabels = readFileSync(LABELS_FILE, 'utf8');

test('parseLabels：解析 repo 內的 labels.yml', () => {
  const groups = parseLabels(realLabels);
  assert.deepEqual(Object.keys(groups), ['core', 'online', 'collab', 'automation']);
  assert.equal(groups.core.length, 11);
  assert.deepEqual(groups.core[0], { name: 'type:feat', color: '1d76db', description: '新功能' });
  assert.ok(groups.core.some((l) => l.description.includes('## 決定')), '描述中的 # 不是註解');
});

test('parseLabels：無法解析的行指出行號', () => {
  const text = '# 註解\ncore:\n  - { name: "a", color: "ffffff", description: "x" }\n  - { name: b }\n';
  assert.throws(() => parseLabels(text), /第 4 行/);
  assert.throws(() => parseLabels('core:\n  - { name: "a", color: "fff", description: "x" }\n'), /第 2 行/);
  assert.throws(() => parseLabels('  - { name: "a", color: "ffffff", description: "x" }\n'), /第 1 行.*不在任何群組/);
});

test('parseLabels：忽略空行與註解，顏色轉小寫', () => {
  const groups = parseLabels('\n# x\ncore:\n\n  - { name: "a", color: "ABCDEF", description: "" }\n');
  assert.deepEqual(groups, { core: [{ name: 'a', color: 'abcdef', description: '' }] });
});

const groups = parseLabels('core:\n  - { name: "a", color: "111111", description: "A" }\n  - { name: "b", color: "222222", description: "B" }\n  - { name: "c", color: "333333", description: "C" }\nonline:\n  - { name: "d", color: "444444", description: "D" }\n');

test('planLabels：不存在 → create；不同 → update；相同 → skip（名稱與顏色不分大小寫）', () => {
  const plan = planLabels(groups, ['core'], [
    { name: 'B', color: '222222', description: '舊描述' },
    { name: 'c', color: '333333', description: 'C' },
  ]);
  assert.deepEqual(plan.map((s) => `${s.action}:${s.label.name}`), ['create:a', 'update:b', 'skip:c']);
  assert.equal(planLabels(groups, ['core'], [{ name: 'a', color: 'AAAAAA', description: 'A' }])[0].action, 'update');
});

test('planLabels：只建立所選模組；不認得的模組報錯', () => {
  assert.deepEqual(planLabels(groups, ['online']).map((s) => s.label.name), ['d']);
  assert.equal(planLabels(groups, ['core', 'online']).length, 4);
  assert.throws(() => planLabels(groups, ['core', 'nope']), /nope.*可用：core、online/);
});

test('labelCommand 與 formatCommand', () => {
  const label = { name: 'type:feat', color: '1d76db', description: '新功能 與 空白' };
  assert.deepEqual(labelCommand('o/r', { action: 'create', label }).slice(0, 4), ['gh', 'label', 'create', 'type:feat']);
  assert.equal(labelCommand('o/r', { action: 'update', label })[2], 'edit');
  assert.equal(formatCommand(['gh', 'label', 'create', "it's", 'a b', 'type:feat']), `gh label create 'it'\\''s' 'a b' type:feat`);
});

test('parseArgs：預設只有 core；--repo 必填', () => {
  assert.deepEqual(parseArgs(['--repo', 'o/r']), { repo: 'o/r', modules: ['core'], dryRun: false });
  assert.deepEqual(parseArgs(['--repo=o/r', '--modules', 'core,online', '--dry-run']).modules, ['core', 'online']);
  assert.throws(() => parseArgs([]), /--repo/);
  assert.throws(() => parseArgs(['--repo', 'noslash']), /--repo/);
  assert.throws(() => parseArgs(['--repo', 'o/r', '--bogus']), /不認得/);
});

// 假的 gh：記錄所有呼叫；讀取類回傳固定資料
function fakeGh({ labels = [], projects = [], failReads = false, emptyReads = false } = {}) {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    const key = args.slice(1, 3).join(' ');
    if (key === 'label list') { if (failReads) throw new Error('HTTP 404'); return emptyReads ? '' : JSON.stringify(labels); }
    if (key === 'project list') { if (failReads) throw new Error('HTTP 404'); return emptyReads ? '' : JSON.stringify({ projects }); }
    if (key === 'project copy') return JSON.stringify({ number: 7 });
    return '';
  };
  return { exec, calls };
}
const isWrite = (args) => !['label list', 'project list'].includes(args.slice(1, 3).join(' '));
const readText = (board) => (f) => (f === CONFIG_FILE ? JSON.stringify({ templateBoard: board }) : realLabels);

test('dry-run：列出標籤與看板指令，不呼叫任何寫入', () => {
  const gh = fakeGh({ labels: [{ name: 'blocked', color: 'b60205', description: '開發中卡住，或 agent 停下等待 ## 決定' }] });
  const out = [];
  const { writes, todos } = run({
    argv: ['--repo', 'me/new-app', '--dry-run'], exec: gh.exec, log: (l) => out.push(l),
    readText: readText({ owner: 'me', number: 3 }),
  });
  assert.equal(gh.calls.filter(isWrite).length, 0, '試跑不得執行寫入');
  assert.equal(writes.length, 10 + 2, 'core 11 個標籤中 1 個已相同；加上看板 copy 與 link');
  const text = out.join('\n');
  assert.match(text, /（試跑）\$ gh label create type:feat --repo me\/new-app --color 1d76db --description '新功能'/);
  assert.match(text, /略過（已存在且相同）：blocked/);
  assert.match(text, /\$ gh project copy 3 --source-owner me --target-owner me --title new-app --format json/);
  assert.match(text, /\$ gh project link '<新看板編號>' --owner me --repo new-app/);
  assert.match(text, /試跑結束：共 12 個寫入指令，未執行/);
  assert.match(todos.at(-1), /auto-add/);
});

test('dry-run：repo 還讀不到時視為沒有標籤，仍列出指令', () => {
  const gh = fakeGh({ failReads: true });
  const { writes } = run({
    argv: ['--repo', 'me/new-app', '--dry-run', '--modules', 'core,automation'], exec: gh.exec, log: () => {},
    readText: readText({ owner: 'me', number: 3 }),
  });
  assert.equal(gh.calls.filter(isWrite).length, 0);
  assert.equal(writes.length, 13 + 2);
});

test('看板編號為 null：略過看板步驟並提示', () => {
  const gh = fakeGh();
  const out = [];
  const { writes, todos } = run({
    argv: ['--repo', 'me/new-app', '--dry-run'], exec: gh.exec, log: (l) => out.push(l),
    readText: readText({ owner: 'me', number: null }),
  });
  assert.ok(writes.every((w) => w[1] === 'label'));
  assert.match(out.join('\n'), /templateBoard\.number 是 null，略過看板步驟/);
  assert.match(todos[0], /範本看板編號/);
});

test('實際執行：建立或更新標籤、複製並連結看板；已有同名看板時只連結', () => {
  const gh = fakeGh({ labels: [{ name: 'rfc', color: '000000', description: 'x' }] });
  run({ argv: ['--repo', 'me/new-app'], exec: gh.exec, log: () => {}, readText: readText({ owner: 'me', number: 3 }) });
  const writes = gh.calls.filter(isWrite).map((a) => a.slice(0, 4).join(' '));
  assert.ok(writes.includes('gh label edit rfc'));
  assert.ok(writes.includes('gh label create type:feat'));
  assert.ok(writes.includes('gh project copy 3'));
  assert.deepEqual(gh.calls.at(-1), ['gh', 'project', 'link', '7', '--owner', 'me', '--repo', 'new-app']);

  const again = fakeGh({ projects: [{ number: 9, title: 'new-app', closed: false }] });
  run({ argv: ['--repo', 'me/new-app'], exec: again.exec, log: () => {}, readText: readText({ owner: 'me', number: 3 }) });
  assert.equal(again.calls.some((a) => a[2] === 'copy'), false);
  assert.deepEqual(again.calls.at(-1), ['gh', 'project', 'link', '9', '--owner', 'me', '--repo', 'new-app']);
});

test('parseGhJson：空輸出視為預設值', () => {
  assert.deepEqual(parseGhJson('', []), []);
  assert.deepEqual(parseGhJson('  \n', {}), {});
  assert.deepEqual(parseGhJson('[{"name":"a"}]', []), [{ name: 'a' }]);
});

test('實際執行：gh 對 label list、project list 輸出空字串時，仍正常建立標籤與看板', () => {
  const gh = fakeGh({ emptyReads: true });
  run({ argv: ['--repo', 'me/new-app'], exec: gh.exec, log: () => {}, readText: readText({ owner: 'me', number: 3 }) });
  const writes = gh.calls.filter(isWrite);
  assert.equal(writes.filter((a) => a[2] === 'create').length, 11);
  assert.ok(writes.some((a) => a[2] === 'copy'));
  assert.deepEqual(gh.calls.at(-1), ['gh', 'project', 'link', '7', '--owner', 'me', '--repo', 'new-app']);
});

test('config.json：記錄範本看板的 owner 與編號', () => {
  const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  assert.equal(typeof config.templateBoard.owner, 'string');
  assert.ok(config.templateBoard.number === null || Number.isInteger(config.templateBoard.number));
});
