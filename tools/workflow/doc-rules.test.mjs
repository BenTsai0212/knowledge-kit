import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// 規則文件：每項規則只留一份正本，其他地方只放連結（dev-workflow-template#55）
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const mdFiles = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '*.md'], { encoding: 'utf8' })
  .split('\0').filter(Boolean).filter((f) => existsSync(join(ROOT, f)));
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

// 程式碼區塊與行內程式碼裡的連結不算
const stripCode = (text) => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

/** 每項規則的特徵字串與它的正本；特徵字串只能出現在正本。 */
const SINGLE_SOURCE = [
  { what: '三級確認表', marker: '| ① 先做後列', source: 'docs/workflow/github-writes.md' },
  { what: '合併的低風險條件', marker: '不含 `docs/workflow/`、`docs/adr/`、`docs/rfcs/`', source: 'docs/workflow/github-writes.md' },
  { what: '可信身分的列舉', marker: '`OWNER`、`MEMBER` 或 `COLLABORATOR`', source: 'docs/workflow/agent-workflow.md' },
  { what: '`plan-first` 的適用情況', marker: '資料庫 schema、登入權限、金流', source: 'docs/workflow/decision-center.md' },
  { what: '核心硬規則表', marker: '| 硬規則 | 來源 | 可刪條件 |', source: null },
];

for (const { what, marker, source } of SINGLE_SOURCE) {
  test(`一份正本：${what}只出現在 ${source ?? '（不再以表格出現）'}`, () => {
    const hits = mdFiles.filter((f) => read(f).includes(marker));
    assert.deepEqual(hits, source ? [source] : [], `${what}出現在：${hits.join('、')}`);
  });
}

// 備援改為選用模組（dev-workflow-template#55 PR B）：核心不再帶 /pm-apply 的檔案與操作說明
test('備援模組：pm-actions.md 與 /pm-apply 只在 templates/modules/fallback/，核心只留連結', () => {
  for (const f of ['docs/workflow/pm-actions.md', '.claude/commands/pm-apply.md']) {
    assert.equal(existsSync(join(ROOT, f)), false, `${f} 應移到 templates/modules/fallback/`);
  }
  for (const f of ['templates/modules/fallback/pm-actions.md', 'templates/modules/fallback/pm-apply.md']) {
    assert.ok(existsSync(join(ROOT, f)), f);
  }
  // 讀不到 GitHub（例如在手機上）是日常情況，留在核心（dev-workflow-template#57 修正要求）
  assert.match(read('docs/workflow/decision-center.md'), /完全讀不到 GitHub（例如在手機上）時，只依交接文件工作/);
  const allowed = (f) => f === 'docs/workflow/modules.md' || f.startsWith('templates/modules/fallback/');
  for (const marker of ['Claude in Chrome', 'Claude outputs/pm/']) {
    const hits = mdFiles.filter((f) => !allowed(f) && read(f).includes(marker));
    assert.deepEqual(hits, [], `「${marker}」出現在核心文件：${hits.join('、')}`);
  }
});

// AGENTS.md 精簡（dev-workflow-template#55 PR C）：細節放在各工具的 README，AGENTS.md 只留指令與「路徑＋一句話」。
// 上限依憲法第 6 節「核心 `AGENTS.md` 目標 40～50 行，加上專案內容後 60～80 行」：本測試隨 template 複製到新專案，
// 新專案加上自己的指令與結構後可到 80 行，所以上限是 80，不是 template 本身的行數（dev-workflow-template#58 修正要求）。
const AGENTS_MAX_LINES = 80;
test(`AGENTS.md 不超過 ${AGENTS_MAX_LINES} 行`, () => {
  const lines = read('AGENTS.md').replace(/\n$/, '').split('\n').length;
  assert.ok(lines <= AGENTS_MAX_LINES, `AGENTS.md 有 ${lines} 行（上限 ${AGENTS_MAX_LINES}，見憲法第 6 節「規則要掙來」）`);
});

// 目標模式（dev-workflow-template#62）：模組檔案、標籤、規則各在一處
test('目標模式：模組檔案與標籤存在，例外規則只寫在 github-writes.md', () => {
  for (const f of ['templates/modules/goal/goal-card.md', 'templates/modules/goal/wake-prompt.md']) {
    assert.ok(existsSync(join(ROOT, f)), f);
  }
  assert.match(read('.github/labels.yml'), /^goal:\n {2}- \{ name: "goal-mode"/m);
  assert.match(read('docs/workflow/modules.md'), /^## 目標模式/m);
  assert.match(read('docs/workflow/decision-center.md'), /^## 10\. 目標模式/m);
  const hits = mdFiles.filter((f) => read(f).includes('### 目標模式下的例外'));
  assert.deepEqual(hits, ['docs/workflow/github-writes.md']);
  // 喚醒的 session 不合併；授權只在決策中心對話（dev-workflow-template#62 決定 D）
  assert.match(read('templates/modules/goal/wake-prompt.md'), /即使有人在這個 session 回覆授權，也不合併/);
  // 喚醒的 session 照文字執行時的範圍與步驟（dev-workflow-template#63 修正要求）
  const dc = read('docs/workflow/decision-center.md');
  assert.match(read('templates/modules/goal/wake-prompt.md'), /處理目標卡範圍以外的工作。範圍＝帶 `goal-mode` 的目標卡本身、掛在其下的子 Issue，以及對應這些子 Issue 的 PR/);
  assert.match(dc, /只處理目標卡的範圍：帶 `goal-mode` 的目標卡本身、掛在其下的子 Issue，以及對應這些子 Issue 的 PR/);
  assert.match(dc, /上次審查後有新的 `## 修正回報`、尚未再審的/);
  assert.match(dc, /依第 5 節第 5、7 項送修正要求/);
  assert.match(dc, /含「等人處理」（合併摘要、等 `## 決定`）或碰到停止條件時，留言中 @ 決定者/);
  // 範本不預設 goal-mode（dev-workflow-template#62 決定 2）
  assert.doesNotMatch(read('templates/modules/goal/goal-card.md').split('---')[1], /goal-mode/);
});

/** GitHub 的標題錨點：轉小寫、去掉標點（含全形）、空白換成 -；重複的標題加 -1、-2。 */
export function anchors(markdown) {
  const seen = new Map();
  const out = new Set();
  for (const line of markdown.replace(/```[\s\S]*?```/g, '').split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '');
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

test('anchors：與 GitHub 的錨點規則一致（中文、全形標點、行內程式碼、重複標題）', () => {
  const a = anchors('## 0. 前置檢查\n## 5. 把決定送回 GitHub\n## 2. 合併：依風險分兩種授權（試驗中）\n### 先審計畫（`plan-first`）\n## 重複\n## 重複\n```\n## 不是標題\n```');
  for (const id of ['0-前置檢查', '5-把決定送回-github', '2-合併依風險分兩種授權試驗中', '先審計畫plan-first', '重複', '重複-1']) {
    assert.ok(a.has(id), id);
  }
  assert.ok(!a.has('不是標題'));
});

test('文件中的相對連結都指向存在的檔案與標題', () => {
  const broken = [];
  for (const file of mdFiles) {
    for (const [, target] of stripCode(read(file)).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const [path, hash] = target.split('#');
      const dest = path ? normalize(join(dirname(file), decodeURIComponent(path))) : file;
      if (!existsSync(join(ROOT, dest))) {
        broken.push(`${file} → ${target}（檔案不存在）`);
        continue;
      }
      if (hash && dest.endsWith('.md') && statSync(join(ROOT, dest)).isFile()) {
        if (!anchors(read(dest)).has(decodeURIComponent(hash))) broken.push(`${file} → ${target}（找不到標題）`);
      }
    }
  }
  assert.deepEqual(broken, [], `\n${broken.join('\n')}`);
  assert.ok(mdFiles.length > 10 && relative(ROOT, ROOT) === '');
});
