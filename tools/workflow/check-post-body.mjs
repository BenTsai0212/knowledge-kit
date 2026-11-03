#!/usr/bin/env node
// 貼出前的檢查：agent 以 gh --body-file 貼出 PR 描述或留言之前，確認檔案是這次、這張 Issue 寫的（#104）。
// 共用的 $TMPDIR 中可能有其他專案留下的同名檔案；寫入失敗時沿用舊檔，會把其他專案的內容貼到本 repo。
// 用法：node tools/workflow/check-post-body.mjs --issue N --kind pr|plan|stop|fix|todo <檔案或 ->
// 通過時以 0 結束；不通過時以 1 結束，agent 不貼出。
// runner 執行時（有 KK_RUN_TMP）：檔案必須在 KK_RUN_TMP 底下、修改時間不早於 KK_RUN_STARTED，不接受標準輸入。
// 內容不能有 email 與個人路徑（#124）：規則與 scripts/check-sensitive.mjs 共用，輸出只列行號與種類，不輸出命中的文字。
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEmails, isAllowedEmail, PERSONAL_PATH } from '../../scripts/check-sensitive.mjs';

// 各種貼出內容的開頭標題；pr 是 PR 描述，改為檢查 Closes／Refs
export const HEADINGS = {
  plan: '## 計畫',
  stop: '## agent 停止',
  fix: '## 修正回報',
  todo: '## 合併後待辦',
};
export const KINDS = ['pr', ...Object.keys(HEADINGS)];
// 手動執行（沒有 KK_RUN_STARTED）時，超過這個時間的檔案視為舊檔
export const MANUAL_MAX_AGE_MS = 30 * 60e3;
// 檔案系統的修改時間可能只精確到秒
const MTIME_SLACK_MS = 1000;

// 與 check-pr-body.mjs 相同：HTML 註解、程式碼區塊與行內程式碼不算內容
const stripCode = (text) => text
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/```[\s\S]*?```/g, '')
  .replace(/`[^`\n]*`/g, '');
const LINKS = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs)\s*:?\s+#(\d+)\b/gi;

/** 內容檢查：回傳問題清單，沒有問題時為空陣列。 */
export function checkContent(body, { issue, kind }) {
  const text = stripCode(body ?? '');
  if (!text.trim()) return ['內容是空的'];
  const errors = [];
  if (kind === 'pr') {
    const linked = [...text.matchAll(LINKS)].map((m) => Number(m[1]));
    if (!linked.includes(issue)) {
      errors.push(`PR 描述沒有 Closes／Refs #${issue}${linked.length ? `（找到的是 ${linked.map((n) => `#${n}`).join('、')}）` : ''}`);
    }
    return errors;
  }
  const heading = HEADINGS[kind];
  if (!body.trimStart().startsWith(heading)) errors.push(`開頭不是「${heading}」`);
  if (!new RegExp(`#${issue}(?!\\d)`).test(text)) errors.push(`內容沒有提到 #${issue}`);
  return errors;
}

/**
 * 敏感資料檢查：不在放行規則內的 email 與個人路徑（#124）。程式碼區塊與行內程式碼貼出後一樣公開，也要檢查；
 * 不比對禁用名稱清單（runner 沒有清單，名稱以 CI 與 check:sensitive --github 為準）。
 * 回傳問題清單，只含行號與種類。
 */
export function checkSensitiveContent(body) {
  const errors = [];
  (body ?? '').split(/\r?\n/).forEach((line, i) => {
    if (findEmails(line).some((address) => !isAllowedEmail(address))) errors.push(`第 ${i + 1} 行：email`);
    if (PERSONAL_PATH.test(line)) errors.push(`第 ${i + 1} 行：個人路徑`);
  });
  return errors;
}

/**
 * 檔案檢查：來源（標準輸入或檔案）、位置與修改時間。回傳問題清單。
 * runTmp：KK_RUN_TMP；startedMs：KK_RUN_STARTED 換算的毫秒；mtimeMs：檔案的修改時間（標準輸入時不用）。
 */
export function checkSource({ file, runTmp, startedMs, mtimeMs, nowMs }) {
  if (file === '-') {
    return runTmp ? ['runner 執行時不接受標準輸入：寫入 KK_RUN_TMP 底下的新檔，檢查後以同一個路徑貼出'] : [];
  }
  const errors = [];
  if (runTmp) {
    const rel = relative(resolve(runTmp), resolve(file));
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
      errors.push(`檔案不在本次執行的暫存資料夾（KK_RUN_TMP）底下：${file}`);
    }
  }
  if (Number.isFinite(startedMs)) {
    if (mtimeMs < startedMs - MTIME_SLACK_MS) errors.push('檔案的修改時間早於本次執行開始，是舊檔');
  } else if (nowMs - mtimeMs > MANUAL_MAX_AGE_MS) {
    errors.push(`檔案是 ${Math.round((nowMs - mtimeMs) / 60e3)} 分鐘前修改的，可能是舊檔`);
  }
  return errors;
}

export function parseArgs(argv) {
  const out = { issue: null, kind: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--issue') out.issue = Number(argv[++i]);
    else if (a === '--kind') out.kind = argv[++i];
    else out.file = a;
  }
  const errors = [];
  if (!Number.isInteger(out.issue) || out.issue < 1) errors.push('--issue 必須是 Issue 編號');
  if (!KINDS.includes(out.kind)) errors.push(`--kind 必須是 ${KINDS.join('、')} 之一`);
  if (!out.file) errors.push('缺少檔案路徑（或 - 表示標準輸入）');
  return { ...out, errors };
}

/** 完整檢查；env 是環境變數。回傳 { ok, errors }。 */
export function checkPostBody(argv, env = process.env, now = Date.now()) {
  const { issue, kind, file, errors } = parseArgs(argv);
  if (errors.length) return { ok: false, errors };
  const runTmp = env.KK_RUN_TMP || null;
  const startedMs = env.KK_RUN_STARTED ? Date.parse(env.KK_RUN_STARTED) : NaN;
  let body;
  let mtimeMs = null;
  try {
    body = readFileSync(file === '-' ? 0 : file, 'utf8');
    if (file !== '-') mtimeMs = statSync(file).mtimeMs;
  } catch (error) {
    return { ok: false, errors: [`無法讀取：${error.message.split('\n')[0]}`] };
  }
  const all = [
    ...checkSource({ file, runTmp, startedMs, mtimeMs, nowMs: now }),
    ...checkContent(body, { issue, kind }),
    ...checkSensitiveContent(body),
  ];
  return { ok: all.length === 0, errors: all };
}

function main() {
  const { ok, errors } = checkPostBody(process.argv.slice(2));
  if (ok) {
    console.log('檢查通過，可以用同一個檔案貼出。');
    return;
  }
  console.error(`不要貼出：\n${errors.map((e) => `- ${e}`).join('\n')}`);
  if (errors.some((e) => /：(?:email|個人路徑)$/.test(e))) {
    console.error('email 與個人路徑改用 user@example.com、/Users/<名稱> 這類佔位寫法（docs/workflow/agent-workflow.md「貼出 PR 描述與留言」）。');
  }
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
