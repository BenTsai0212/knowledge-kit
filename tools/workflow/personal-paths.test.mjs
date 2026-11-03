// 開發流程工具公開後別人也會 fork 使用，不能寫死個人的家目錄路徑（#96）。
// 只比對 /Users/<名稱>、/home/<名稱> 的格式，不寫入任何個人名稱。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCOPE = ['tools/workflow', '.claude', 'docs/workflow', 'AGENTS.md', 'CLAUDE.md', '.github', 'templates'];
// GitHub Actions 的執行環境 /home/runner 不算個人路徑（#113）；與 scripts/check-sensitive.mjs 的規則一致
const PERSONAL_PATH = /\/(?:Users\/|home\/(?!runner(?![\w.-])))[\w.-]+/g;

export function findPersonalPaths(text) {
  return text.match(PERSONAL_PATH) ?? [];
}

test('比對 /Users/<名稱> 與 /home/<名稱>，不比對佔位符與其他路徑', () => {
  // 以 join 組出範例路徑，避免本檔被下一個測試抓到
  const users = ['', 'Users', 'someone'].join('/');
  const home = ['', 'home', 'a.b'].join('/');
  assert.deepEqual(findPersonalPaths(`cd ${users}/x && ls ${home}`), [users, home]);
  assert.deepEqual(findPersonalPaths('/Users/<名稱>、~/Projects、/opt/homebrew/bin/gh、/usr/local'), []);
});

test('GitHub Actions 的 /home/runner 不算個人路徑，其他以 runner 開頭的名稱照常比對', () => {
  const others = ['runner2', 'runner.x', 'runners'].map((name) => ['', 'home', name].join('/'));
  assert.deepEqual(findPersonalPaths('/home/runner/work/kit/kit、/home/runner'), []);
  assert.deepEqual(findPersonalPaths(others.join(' ')), others);
  const macRunner = ['', 'Users', 'runner'].join('/');
  assert.deepEqual(findPersonalPaths(macRunner), [macRunner]);
});

test('與 scripts/check-sensitive.mjs 的個人路徑規則一致', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'check-sensitive.mjs'), 'utf8');
  const rule = /^const PERSONAL_PATH = \/(.+)\/;$/m.exec(script);
  assert.ok(rule, 'scripts/check-sensitive.mjs 找不到 PERSONAL_PATH');
  assert.equal(rule[1], PERSONAL_PATH.source);
});

test('開發流程工具的檔案沒有個人路徑', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', ...SCOPE], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  assert.ok(files.length > 0, 'git ls-files 沒有列出任何檔案');
  const found = [];
  for (const file of files) {
    const hits = findPersonalPaths(readFileSync(join(ROOT, file), 'utf8'));
    if (hits.length) found.push(`${file}: ${[...new Set(hits)].join(', ')}`);
  }
  assert.deepEqual(found, []);
});
