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
const PERSONAL_PATH = /\/(?:Users|home)\/[\w.-]+/g;

export function findPersonalPaths(text) {
  return text.match(PERSONAL_PATH) ?? [];
}

test('比對 /Users/<名稱> 與 /home/<名稱>，不比對佔位符與其他路徑', () => {
  assert.deepEqual(findPersonalPaths('cd /Users/someone/x && ls /home/a.b'), ['/Users/someone', '/home/a.b']);
  assert.deepEqual(findPersonalPaths('/Users/<名稱>、~/Projects、/opt/homebrew/bin/gh、/usr/local'), []);
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
