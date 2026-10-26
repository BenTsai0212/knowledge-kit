#!/usr/bin/env node
// Claude Code PreToolUse hook（matcher: Bash）：合併 PR、push 到 main、對 main 強制推送前跳出確認。
// 憲法第 6 節「程式化防護」；AGENTS.md 第 5 節第 1 條硬規則。
// 只輸出 ask，不輸出 deny：人同意後指令照常執行（/pm-apply 的合併仍可運作）。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN_REFS = new Set(['main', 'refs/heads/main']);
// 會連同 main 一起推送的選項
const ALL_BRANCH_FLAGS = new Set(['--all', '--branches', '--mirror']);
const FORCE_FLAGS = new Set(['--force', '-f', '--force-with-lease']);
const GIT_GLOBAL_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const PUSH_OPTS_WITH_VALUE = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);
// 出現在指令開頭、本身不是指令的 shell 保留字
const RESERVED_WORDS = new Set(['{', '}', '!', 'if', 'then', 'elif', 'else', 'while', 'until', 'do']);
// 包裝指令：後面接的才是真正執行的指令。值為需要帶值的選項。
const WRAPPERS = new Map([
  ['sudo', new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T', '-R'])],
  ['doas', new Set(['-u', '-C'])],
  ['env', new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string'])],
  ['command', new Set()],
  ['exec', new Set(['-a'])],
  ['nohup', new Set()],
  ['time', new Set()],
  ['nice', new Set(['-n', '--adjustment'])],
]);
// 以 -c 執行字串的 shell；字串內容遞迴判斷
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const SHELL_OPTS_WITH_VALUE = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);
const PR_MERGE_PATH = /^\/?repos\/[^/]+\/[^/]+\/pulls\/[^/]+\/merge\/?$/;
const MERGE_MUTATION = /\b(mergePullRequest|enablePullRequestAutoMerge)\b/;
// 目錄或分支無法判斷
const UNKNOWN = Symbol('unknown');

// 依 &&、||、;、|、&、換行切段，並把每段切成 token；引號內的文字視為一般字元。
// 子 shell 的 ( 與 ) 各自成為只有一個 token 的段，用來還原子 shell 內 cd 前的目錄。
export function splitCommands(command) {
  const segments = [];
  let tokens = [];
  let token = null;
  let quote = null;
  const endToken = () => {
    if (token !== null) tokens.push(token);
    token = null;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length) segments.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < command.length) token += command[++i];
      else token += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      token ??= '';
    } else if (c === '\\' && i + 1 < command.length) {
      token = (token ?? '') + command[++i];
    } else if (c === ';' || c === '|' || c === '&' || c === '\n') {
      endSegment();
    } else if (c === '(' || c === ')') {
      endSegment();
      segments.push([c]);
    } else if (/\s/.test(c)) {
      endToken();
    } else {
      token = (token ?? '') + c;
    }
  }
  endSegment();
  return segments;
}

const isFlag = (t) => t.startsWith('-') && t !== '-';
const isAssignment = (t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t);
const basename = (p) => p.slice(p.lastIndexOf('/') + 1);

// 去掉開頭的保留字、環境變數設定與包裝指令（sudo、env 等），回傳真正執行的指令。
function unwrap(tokens) {
  let i = 0;
  while (i < tokens.length) {
    if (RESERVED_WORDS.has(tokens[i]) || isAssignment(tokens[i])) {
      i += 1;
      continue;
    }
    const opts = WRAPPERS.get(basename(tokens[i]));
    if (!opts) break;
    i += 1;
    while (i < tokens.length && (isFlag(tokens[i]) || isAssignment(tokens[i]))) {
      if (tokens[i] === '--') {
        i += 1;
        break;
      }
      i += opts.has(tokens[i]) ? 2 : 1;
    }
  }
  return tokens.slice(i);
}

// sh -c '…' 的字串；沒有 -c 時回傳 null。
function shellScript(args) {
  let hasC = false;
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (SHELL_OPTS_WITH_VALUE.has(t)) i += 1;
    else if (/^-[A-Za-z]+$/.test(t)) hasC ||= t.includes('c');
    else if (!/^[-+]/.test(t)) return hasC ? t : null;
  }
  return null;
}

// 回傳 cd 之後的狀態；目的地含變數、萬用字元或 cd - 時目錄視為無法判斷。
function changeDir(state, args) {
  const operands = args.filter((t) => !isFlag(t));
  const target = operands[0];
  let dir;
  if (target === undefined) dir = homedir();
  else if (target === '~' || target.startsWith('~/')) dir = homedir() + target.slice(1);
  else if (args.includes('-') || /[$`*?[~]/.test(target)) dir = UNKNOWN;
  else if (state.dir === UNKNOWN && !isAbsolute(target)) dir = UNKNOWN;
  else dir = resolve(state.dir ?? process.cwd(), target);
  return { dir, moved: true };
}

// 指令中切換過目錄後，分支無法判斷（null）也視為 UNKNOWN。
function branchAt(state, ctx) {
  if (state.dir === UNKNOWN) return UNKNOWN;
  const branch = ctx.currentBranch(state.dir);
  return branch == null && state.moved ? UNKNOWN : branch;
}

function checkGhMerge(args) {
  const words = args.filter((t) => !isFlag(t));
  return words[0] === 'pr' && words[1] === 'merge';
}

// gh api -X PUT repos/<owner>/<repo>/pulls/<N>/merge，或 GraphQL 的合併 mutation。
function checkGhApiMerge(args) {
  const words = args.filter((t) => !isFlag(t));
  if (words[0] !== 'api') return false;
  if (words.includes('graphql') && args.some((t) => MERGE_MUTATION.test(t))) return true;
  let method = null;
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '-X' || t === '--method') method = args[i + 1];
    else if (t.startsWith('--method=')) method = t.slice('--method='.length);
    else if (/^-X./.test(t)) method = t.slice(2);
  }
  return method?.toUpperCase() === 'PUT' && words.some((t) => PR_MERGE_PATH.test(t));
}

// 回傳 { force, uncertain } 表示這段 push 的目標是 main 或無法判斷（uncertain：只因分支無法判斷而攔）；不是則回傳 null。
function checkGitPush(args, state, ctx) {
  let i = 0;
  while (i < args.length && isFlag(args[i])) {
    const opt = args[i].split('=')[0];
    if (opt === '--git-dir' || opt === '--work-tree') state = { dir: UNKNOWN, moved: true };
    if (GIT_GLOBAL_OPTS_WITH_VALUE.has(opt) && opt === args[i]) {
      if (opt === '-C') state = changeDir(state, [args[i + 1]]);
      i += 2;
    } else {
      i += 1;
    }
  }
  if (args[i] !== 'push') return null;

  let force = false;
  let allBranches = false;
  let repoGiven = false;
  const positional = [];
  for (let j = i + 1; j < args.length; j++) {
    const t = args[j];
    if (t === '--') {
      positional.push(...args.slice(j + 1));
      break;
    }
    if (!isFlag(t)) {
      positional.push(t);
      continue;
    }
    const name = t.split('=')[0];
    if (FORCE_FLAGS.has(name)) force = true;
    else if (/^-[a-zA-Z]*f/.test(t) && !t.startsWith('--')) force = true;
    if (ALL_BRANCH_FLAGS.has(name)) allBranches = true;
    // 指定 --repo 時，位置參數全是 refspec
    if (name === '--repo') repoGiven = true;
    if (PUSH_OPTS_WITH_VALUE.has(t)) j += 1;
  }

  const refspecs = repoGiven ? positional : positional.slice(1);
  // definite：確定推到 main；unknown：分支無法判斷（視為 main，但訊息不同）
  let definite = allBranches;
  let unknown = false;
  const mark = (ref) => {
    if (ref === UNKNOWN) unknown = true;
    else if (isMainBranch(ref)) definite = true;
  };
  if (refspecs.length === 0) mark(branchAt(state, ctx));
  for (const spec of refspecs) {
    const plus = spec.startsWith('+');
    const body = plus ? spec.slice(1) : spec;
    const colon = body.indexOf(':');
    let dst = colon === -1 ? body : body.slice(colon + 1);
    if (dst === 'HEAD' || dst === '@') dst = branchAt(state, ctx);
    if (targetsMainBranch(dst)) {
      mark(dst);
      if (plus) force = true;
    }
  }
  return definite || unknown ? { force, uncertain: !definite } : null;
}

const isMainBranch = (ref) => ref != null && MAIN_REFS.has(ref);
// 分支無法判斷時一律視為 main
const targetsMainBranch = (ref) => ref === UNKNOWN || isMainBranch(ref);

// 回傳 { reason } 表示需要人確認；不需要時回傳 null。
export function evaluate(command, ctx = {}) {
  const cache = new Map();
  const context = {
    currentBranch: (dir) => {
      if (!cache.has(dir)) cache.set(dir, (ctx.currentBranch ?? gitCurrentBranch)(dir));
      return cache.get(dir);
    },
  };
  return evaluateIn(command, { dir: ctx.cwd, moved: false }, context);
}

// state：{ dir, moved }，dir 是目前目錄（UNKNOWN 表示無法判斷），moved 表示指令中切換過目錄。
function evaluateIn(command, state, ctx) {
  const subshells = [];
  for (const tokens of splitCommands(command)) {
    if (tokens.length === 1 && tokens[0] === '(') {
      subshells.push(state);
      continue;
    }
    if (tokens.length === 1 && tokens[0] === ')') {
      state = subshells.pop() ?? state;
      continue;
    }
    const words = unwrap(tokens);
    if (words.length === 0) continue;
    const [program, ...args] = words;
    const name = basename(program);
    const text = words.join(' ');
    if (name === 'cd' || name === 'pushd') {
      state = changeDir(state, args);
    } else if (name === 'popd') {
      state = { dir: UNKNOWN, moved: true };
    } else if (SHELLS.has(name) || name === 'eval') {
      const script = name === 'eval' ? args.join(' ') : shellScript(args);
      const result = script ? evaluateIn(script, state, ctx) : null;
      if (result) return result;
    } else if (name === 'gh' && (checkGhMerge(args) || checkGhApiMerge(args))) {
      return { reason: `即將合併 PR（${text}）。合併由人決定（AGENTS.md 第 5 節），請確認後再同意。` };
    } else if (name === 'git') {
      const push = checkGitPush(args, state, ctx);
      if (push?.uncertain) {
        const kind = push.force ? '強制推送' : '推送';
        return { reason: `無法判斷${kind}的目標分支（${text}），可能是 main。請確認目標分支後再同意；agent 推送時請直接寫明分支，例如 git push origin HEAD:<分支>。` };
      }
      if (push?.force) {
        return { reason: `即將對 main 強制推送（${text}）。這會改寫 main 的歷史，請確認後再同意。` };
      }
      if (push) {
        return { reason: `即將推送到 main（${text}）。agent 不 push 到 main（AGENTS.md 第 5 節），請確認後再同意。` };
      }
    }
  }
  return null;
}

function gitCurrentBranch(dir) {
  try {
    return execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd: dir || undefined,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const command = input?.tool_input?.command;
  if (typeof command !== 'string') return;
  const result = evaluate(command, { cwd: input.cwd });
  if (!result) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: result.reason,
      },
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
