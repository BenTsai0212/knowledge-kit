#!/usr/bin/env node
// 從 template 建立新 repo 後，一個指令完成標籤建立、範本看板複製與連結（憲法第 9 節 B 段第 2 步）。
// 用法：node tools/workflow/bootstrap-github.mjs --repo <owner/name> [--modules core,online,collab,automation] [--dry-run]
// --modules 預設只有 core；--dry-run 只列出將執行的 gh 指令（仍會讀取現有標籤與看板，不做任何寫入）。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LABELS_FILE = join(HERE, '..', '..', '.github', 'labels.yml');
export const CONFIG_FILE = join(HERE, 'config.json');

const GROUP = /^([A-Za-z][\w-]*):\s*$/;
const ITEM = /^\s+-\s*\{\s*name:\s*"([^"]+)",\s*color:\s*"([0-9a-fA-F]{6})",\s*description:\s*"([^"]*)"\s*\}\s*$/;

/** 解析 .github/labels.yml 目前的單行格式；無法解析的行丟出含行號的錯誤。 */
export function parseLabels(text) {
  const groups = {};
  let current = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    const g = GROUP.exec(line);
    if (g) {
      current = g[1];
      groups[current] ??= [];
      return;
    }
    const m = ITEM.exec(line);
    if (m && current) {
      groups[current].push({ name: m[1], color: m[2].toLowerCase(), description: m[3] });
      return;
    }
    throw new Error(`labels.yml 第 ${i + 1} 行無法解析${m ? '（標籤不在任何群組下）' : ''}：${line.trim()}`);
  });
  return groups;
}

/** 依模組選出標籤，與現有標籤比對：不存在 → create；顏色或描述不同 → update；相同 → skip。 */
export function planLabels(groups, modules, existing = []) {
  const unknown = modules.filter((m) => !groups[m]);
  if (unknown.length) {
    throw new Error(`labels.yml 沒有模組：${unknown.join('、')}（可用：${Object.keys(groups).join('、')}）`);
  }
  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));
  return modules.flatMap((m) =>
    groups[m].map((label) => {
      const cur = byName.get(label.name.toLowerCase());
      if (!cur) return { action: 'create', label };
      const same = cur.color.toLowerCase() === label.color && (cur.description ?? '') === label.description;
      return { action: same ? 'skip' : 'update', label };
    }),
  );
}

export function labelCommand(repo, { action, label }) {
  const verb = action === 'create' ? 'create' : 'edit';
  return ['gh', 'label', verb, label.name, '--repo', repo, '--color', label.color, '--description', label.description];
}

/** 指令顯示用：含空白或特殊字元的參數加上單引號。 */
export function formatCommand(args) {
  return args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
}

/** gh 的 JSON 輸出；沒有資料時 gh 可能輸出空字串（例如剛建立、還沒有任何標籤的 repo），視為 fallback。 */
export function parseGhJson(out, fallback) {
  return out && out.trim() ? JSON.parse(out) : fallback;
}

export function parseArgs(argv) {
  const opts = { repo: null, modules: ['core'], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--repo') opts.repo = argv[++i];
    else if (a.startsWith('--repo=')) opts.repo = a.slice(7);
    else if (a === '--modules') opts.modules = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--modules=')) opts.modules = a.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`不認得的參數：${a}`);
  }
  if (!opts.repo || !/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error('需要 --repo <owner/name>');
  if (!opts.modules.length) throw new Error('--modules 不能是空的');
  return opts;
}

/**
 * 主流程。exec(args) 執行 gh 並回傳 stdout；讀取類指令在 dry-run 時也會執行，寫入類只在非 dry-run 時執行。
 * 回傳 { writes, todos }，方便測試。
 */
export function run({ argv, exec, readText = (f) => readFileSync(f, 'utf8'), log = console.log }) {
  const opts = parseArgs(argv);
  const [owner, name] = opts.repo.split('/');
  const groups = parseLabels(readText(LABELS_FILE));
  const config = JSON.parse(readText(CONFIG_FILE));
  const writes = [];
  const todos = [];
  const write = (args, describe) => {
    writes.push(args);
    log(`${opts.dryRun ? '（試跑）' : ''}$ ${formatCommand(args)}`);
    if (!opts.dryRun) return exec(args);
    return describe ?? '';
  };

  log(`== 標籤（模組：${opts.modules.join('、')}）==`);
  let existing = [];
  try {
    existing = parseGhJson(exec(['gh', 'label', 'list', '--repo', opts.repo, '--limit', '500', '--json', 'name,color,description']), []);
  } catch (error) {
    if (!opts.dryRun) throw error;
    log(`（試跑）無法讀取現有標籤，視為沒有標籤：${error.message.split('\n')[0]}`);
  }
  const plan = planLabels(groups, opts.modules, existing);
  for (const step of plan) {
    if (step.action === 'skip') log(`略過（已存在且相同）：${step.label.name}`);
    else write(labelCommand(opts.repo, step));
  }
  const count = (a) => plan.filter((s) => s.action === a).length;
  log(`標籤：新增 ${count('create')}、更新 ${count('update')}、略過 ${count('skip')}`);

  log('== 看板 ==');
  const board = config.templateBoard ?? {};
  if (board.number === null || board.number === undefined) {
    log(`tools/workflow/config.json 的 templateBoard.number 是 null，略過看板步驟（範本看板建立後填入編號）。`);
    todos.push('建立看板：範本看板編號填入 tools/workflow/config.json 後重新執行，或手動複製看板');
  } else {
    let projects = [];
    try {
      projects = parseGhJson(exec(['gh', 'project', 'list', '--owner', owner, '--limit', '200', '--format', 'json']), {}).projects ?? [];
    } catch (error) {
      if (!opts.dryRun) throw error;
      log(`（試跑）無法讀取 ${owner} 的看板：${error.message.split('\n')[0]}`);
    }
    const found = projects.find((p) => p.title === name && !p.closed);
    let number;
    if (found) {
      number = String(found.number);
      log(`略過複製：${owner} 已有標題為「${name}」的看板 #${number}`);
    } else {
      const out = write(['gh', 'project', 'copy', String(board.number), '--source-owner', board.owner,
        '--target-owner', owner, '--title', name, '--format', 'json']);
      number = opts.dryRun ? '<新看板編號>' : String(JSON.parse(out).number);
    }
    write(['gh', 'project', 'link', number, '--owner', owner, '--repo', name]);
    todos.push(`在新看板（${owner} 的 #${number}「${name}」）的 Workflows 手動開啟 auto-add：複製不會帶過來（憲法第 9 節 B 段第 3 步）`);
  }

  log('== 需要人工處理 ==');
  todos.forEach((t, i) => log(`${i + 1}. ${t}`));
  if (opts.dryRun) log(`試跑結束：共 ${writes.length} 個寫入指令，未執行。`);
  return { writes, todos };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    run({
      argv: process.argv.slice(2),
      exec: (args) => execFileSync(args[0], args.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    });
  } catch (error) {
    console.error(`錯誤：${error.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
}
