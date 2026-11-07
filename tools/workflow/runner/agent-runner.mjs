#!/usr/bin/env node
// 本機 agent runner：依 GitHub 標籤啟動 coding agent 執行 /work-on-issue（自動化模組，試驗中）。
// 一次做一件，做完且條件允許時接下一件（連續處理）；合併永遠由人決定。說明見同資料夾的 README.md。
// 用法：
//   node tools/workflow/runner/agent-runner.mjs --dry-run   只顯示會挑哪一件，不改 GitHub、不動 worktree
//   node tools/workflow/runner/agent-runner.mjs --now       不受執行時段與最晚開始時間限制，實際執行一件
//   node tools/workflow/runner/agent-runner.mjs             排程用：只在執行時段內執行，可連續處理
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  BASE_SETTINGS_FILE, CONFIG_FILE, GENERATED_SETTINGS_FILE, GLOBAL_DIR, GLOBAL_LOCK, GLOBAL_PAUSE,
  PROJECT_PAUSE, readConfig, repoRoot, resolvePaths,
} from './config.mjs';
import {
  advanceAwake, agentNote, buildSettings, canStartNew, countOpenPrs, GH_RETRY_MS, inHours, isRunTmpDir, isTransientGhError,
  issueAssociations, lockIsActive, needsWipSave, orderWork, pickWork, recordRunnerError, remainingLabels, runnerReminder,
  runTmpDir, runTmpEnv, shouldContinue, staleWorking, stopReportBody, TICK_MS, validateConfig, wipBranchName, withAssociation,
} from './lib.mjs';
import { notify } from './platform.mjs';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const NOW = args.has('--now');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

let logFile = null;
function log(...m) {
  const line = `[${new Date().toLocaleString('zh-TW', { hour12: false })}] ${m.join(' ')}`;
  console.log(line);
  if (logFile) appendFileSync(logFile, line + '\n');
}

const firstLine = (error) => error.message.split('\n')[0];
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// 重複錯誤的狀態檔（每個 repo 的 logs/ 底下，不進版本控制）；試跑時不設定，不寫狀態檔、不留言（dev-workflow-template#45）
let errorTracking = null;

/**
 * runner 自身的錯誤：寫紀錄並發本機通知，不改標籤（GitHub 上的停止回報只用於需要人決定的問題）。
 * 同一個錯誤連續 REMIND_AFTER 次且與 Issue 有關時，在該 Issue 留一次 `## runner 提醒`（lib.mjs 的 recordRunnerError）。
 */
function runnerError(what, error, { stage = what, issue = null } = {}) {
  log('runner 錯誤：', what, error.message);
  notify(`${what}：${firstLine(error)}（詳見 logs）`);
  if (!errorTracking) return;
  const { file, remind: postReminder } = errorTracking;
  try {
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    const { state, remind } = recordRunnerError(prev, { stage, message: error.message, issue });
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    log(`同一個錯誤連續 ${state.count} 次（狀態檔：${file}）`);
    if (remind && postReminder(issue, state)) log(`已在 #${issue} 留 runner 提醒`);
  } catch (e) {
    log('記錄重複錯誤或留 runner 提醒失敗：', firstLine(e));
  }
}

async function main() {
  // 設定檔：不存在或有問題時列出原因並結束，不執行
  const config = readConfig();
  if (!config) {
    console.error(`找不到設定檔：${CONFIG_FILE}\n請複製 config.example.json 為 config.local.json 並填寫（見 README）。`);
    process.exitCode = 1;
    return;
  }
  const errors = validateConfig(config);
  if (errors.length) {
    console.error(`設定檔有問題（${CONFIG_FILE}）：\n${errors.map((e) => `- ${e}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  const labelNames = (x) => (x?.labels ?? []).map((l) => l.name);
  const ROOT = repoRoot();
  const { worktree: WORKTREE, logDir: LOG_DIR } = resolvePaths(config, ROOT);
  const REPO = config.repo;
  const ME = config.account;
  mkdirSync(LOG_DIR, { recursive: true });
  logFile = join(LOG_DIR, `${stamp}${DRY ? '-dry' : ''}.log`);
  const relLog = relative(ROOT, logFile);

  /** gh：暫時性錯誤（連線中斷、unexpected EOF、HTTP 5xx、逾時）時等待後重試一次，其他錯誤直接丟出（dev-workflow-template#45）。 */
  const ghOnce = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120e3 });
  const gh = (...a) => {
    try {
      return ghOnce(a);
    } catch (error) {
      if (!isTransientGhError(`${error.code ?? ''}\n${error.message}\n${error.stderr ?? ''}`)) throw error;
      log(`gh 暫時性錯誤，${GH_RETRY_MS / 1e3} 秒後重試一次：gh ${a.slice(0, 2).join(' ')}：${firstLine(error)}`);
      sleepSync(GH_RETRY_MS);
      return ghOnce(a);
    }
  };
  const ghJson = (...a) => JSON.parse(gh(...a) || 'null');
  if (!DRY) {
    errorTracking = {
      file: join(LOG_DIR, 'runner-errors.json'),
      /** 遮蔽本機路徑後仍有 email 或個人路徑時不貼出，只寫紀錄與通知；有貼出時回傳 true。 */
      remind: (issue, state) => {
        const { body, errors } = runnerReminder({ ...state, logPath: relLog },
          { worktree: WORKTREE, repoRoot: ROOT, home: homedir() });
        if (!body) {
          log(`#${issue} 的 runner 提醒含敏感內容，未貼出（${errors.join('、')}）`);
          notify(`#${issue} 的 runner 提醒含敏感內容，未貼出（詳見 logs）`);
          return false;
        }
        gh('issue', 'comment', String(issue), '-R', REPO, '--body', body);
        return true;
      },
    };
  }
  /** 處理成功一次後，重複錯誤的計數歸零。 */
  function clearErrorState() {
    if (errorTracking && existsSync(errorTracking.file)) {
      unlinkSync(errorTracking.file);
      log('處理成功，重複錯誤的計數歸零');
    }
  }
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  /**
   * 加／移除標籤。移除後讀回確認：仍存在時重試一次，仍失敗就丟出錯誤（由呼叫端以 runnerError 處理）。
   * 移除不存在的標籤時 gh 可能回報錯誤，以讀回的結果為準（dev-workflow-template#45）。
   */
  function setLabels(issue, add = [], remove = []) {
    for (const l of add) gh('issue', 'edit', String(issue), '-R', REPO, '--add-label', l);
    if (!remove.length) return;
    let left = remove;
    let lastError = null;
    for (let attempt = 0; attempt < 2 && left.length; attempt++) {
      for (const l of left) {
        try { gh('issue', 'edit', String(issue), '-R', REPO, '--remove-label', l); } catch (error) { lastError = error; }
      }
      left = remainingLabels(labelNames(ghJson('issue', 'view', String(issue), '-R', REPO, '--json', 'labels')), remove);
      if (left.length && attempt === 0) log(`#${issue} 的標籤移除後仍存在：${left.join('、')}，重試一次`);
    }
    if (left.length) {
      throw new Error(`無法移除 #${issue} 的標籤：${left.join('、')}${lastError ? `（${firstLine(lastError)}）` : ''}`);
    }
  }

  function stopReport(issue, step, reason, facts) {
    gh('issue', 'comment', String(issue), '-R', REPO, '--body',
      stopReportBody({ step, reason, facts, account: ME, logPath: relLog }));
    setLabels(issue, ['blocked'], ['agent:working']);
  }

  /** 看板：加入 Issue 並設定 Status；沒有設定看板或失敗時不影響主要流程。 */
  function setBoardStatus(issue, statusName) {
    if (!config.board) return;
    const { owner, number } = config.board;
    try {
      const fields = ghJson('project', 'field-list', String(number), '--owner', owner, '--format', 'json').fields;
      const status = fields.find((f) => f.name === 'Status');
      const option = status?.options?.find((o) => o.name.toLowerCase() === statusName.toLowerCase());
      if (!status || !option) throw new Error(`找不到 Status「${statusName}」`);
      const projectId = ghJson('project', 'view', String(number), '--owner', owner, '--format', 'json').id;
      const item = ghJson('project', 'item-add', String(number), '--owner', owner,
        '--url', `https://github.com/${REPO}/issues/${issue}`, '--format', 'json');
      gh('project', 'item-edit', '--id', item.id, '--project-id', projectId,
        '--field-id', status.id, '--single-select-option-id', option.id);
      log(`看板：#${issue} → ${option.name}`);
    } catch (error) {
      log('看板更新失敗（不影響執行）：', error.message.split('\n')[0]);
    }
  }

  /** runner 專用 worktree：從 origin/main 開始，並清除 runner/* 本地分支（修正模式用，見 agentNote）。 */
  function prepareWorktree() {
    git(ROOT, 'fetch', 'origin');
    if (!existsSync(WORKTREE)) {
      log('建立 runner 專用資料夾：', WORKTREE);
      git(ROOT, 'worktree', 'add', '--detach', WORKTREE, 'origin/main');
    }
    if (git(WORKTREE, 'status', '--porcelain')) throw new Error(`runner 資料夾有未提交的變更：${WORKTREE}`);
    git(WORKTREE, 'checkout', '--detach', 'origin/main');
    const old = git(WORKTREE, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/runner/').split('\n').filter(Boolean);
    for (const b of old) git(WORKTREE, 'branch', '-D', b);
    if (old.length) log('清除 runner 本地分支：', old.join('、'));
  }

  /** 給 agent 的執行環境：sandbox 內 gh 讀不到鑰匙圈與系統憑證，由 runner 先在外面取得。 */
  function agentEnv() {
    const env = { ...process.env, ...(config.env ?? {}) };
    env.GH_TOKEN = gh('auth', 'token').trim();
    env.SSL_CERT_FILE = '/etc/ssl/cert.pem';
    // 開分支時不寫入主 repo 的 .git/config（sandbox 不允許），等同 git switch --no-track
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'branch.autoSetupMerge';
    env.GIT_CONFIG_VALUE_0 = 'false';
    return env;
  }

  function writeSettings() {
    const base = JSON.parse(readFileSync(BASE_SETTINGS_FILE, 'utf8'));
    const settings = buildSettings(base, { repoRoot: ROOT, config });
    mkdirSync(dirname(GENERATED_SETTINGS_FILE), { recursive: true });
    writeFileSync(GENERATED_SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    return settings;
  }

  /**
   * claude 中斷後保存進度：有未提交的修改或未推送的 commit 時，commit 到新的 wip/ 分支並推送，worktree 回到 origin/main。
   * 不推到 agent 原本的分支（可能已開 PR）；commit 失敗時才 git stash。不刪除任何東西。回傳寫進停止回報的說明。
   */
  function saveWip(issue) {
    const status = git(WORKTREE, 'status', '--porcelain');
    let unpushed = 0;
    try { unpushed = Number(git(WORKTREE, 'rev-list', '--count', 'HEAD', '--not', '--remotes')); } catch {}
    if (!needsWipSave({ status, unpushed })) return 'worktree 沒有未提交的修改或未推送的 commit，不需要保存進度';
    const now = new Date();
    const branch = wipBranchName(issue, now);
    try {
      git(WORKTREE, 'switch', '-c', branch);
      if (status) {
        git(WORKTREE, 'add', '-A');
        git(WORKTREE, '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', `wip: #${issue} runner 中斷時保存的進度`);
      }
    } catch (error) {
      const message = `runner-wip ${issue} ${now.toISOString()}`;
      log('WIP commit 失敗，改用 stash：', error.message);
      git(WORKTREE, 'stash', 'push', '-u', '-m', message);
      return `WIP commit 失敗（${firstLine(error)}），進度已存成 git stash「${message}」`;
    }
    let pushed = true;
    try {
      git(WORKTREE, 'push', 'origin', `HEAD:refs/heads/${branch}`);
    } catch (error) {
      pushed = false;
      log('WIP 分支推送失敗：', error.message);
    }
    git(WORKTREE, 'checkout', '--detach', 'origin/main');
    return pushed
      ? `進度已保存到分支 \`${branch}\`（已推送）`
      : `進度已保存到本機分支 \`${branch}\`（推送失敗，只在 runner 的 worktree）`;
  }

  /** 刪除本次執行的暫存資料夾；只刪 runTmpDir 產生的路徑，不碰其他檔案（#104）。 */
  function removeRunTmp(dir) {
    if (!isRunTmpDir(WORKTREE, dir)) throw new Error(`不是本次執行的暫存資料夾，不刪除：${dir}`);
    rmSync(dir, { recursive: true, force: true });
  }

  async function runClaude(issue) {
    let env;
    const startedAt = new Date();
    const runTmp = runTmpDir(WORKTREE, issue, startedAt);
    try {
      env = agentEnv();
      removeRunTmp(runTmp);
      mkdirSync(runTmp, { recursive: true });
      Object.assign(env, runTmpEnv(runTmp, startedAt));
    } catch (error) {
      return { code: null, killedFor: `無法啟動 claude：${firstLine(error)}` };
    }
    log('本次的暫存資料夾：', relative(ROOT, runTmp));
    return new Promise((done) => {
      const out = join(LOG_DIR, `${stamp}-claude-${issue}.log`);
      writeFileSync(out, '');
      log('執行：claude -p "/work-on-issue', issue, '"，即時紀錄：', relative(ROOT, out));
      const child = spawn('claude', ['-p', `/work-on-issue ${issue}`, '--settings', GENERATED_SETTINGS_FILE,
        '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose',
        '--append-system-prompt', agentNote(config, { runTmp })],
      { cwd: WORKTREE, stdio: ['ignore', 'pipe', 'pipe'], env });
      let killedFor = null;
      let checkedAuth = false;
      let buffer = '';
      child.stdout.on('data', (d) => {
        appendFileSync(out, d);
        if (checkedAuth) return;
        buffer += d.toString();
        const line = buffer.split('\n').find((l) => l.includes('"subtype":"init"'));
        if (!line) return;
        checkedAuth = true;
        try {
          const source = JSON.parse(line).apiKeySource;
          if (source && source !== 'none') {
            log(`偵測到使用 API Key（${source}），會產生 API 費用，立即終止`);
            killedFor = `使用 API Key 計費（${source}）`;
            child.kill('SIGTERM');
          } else log('計費方式：使用登入的訂閱帳號');
        } catch {
          log('無法讀取計費方式，繼續執行');
        }
      });
      child.stderr.on('data', (d) => appendFileSync(out, d));
      // 時間上限只算醒著的時間：筆電休眠的那段只算一次間隔
      let awake = { awakeMs: 0, lastTick: Date.now() };
      const timer = setInterval(() => {
        const { sleptMs, ...next } = advanceAwake(awake, Date.now());
        awake = next;
        if (sleptMs) log(`偵測到休眠約 ${Math.round(sleptMs / 60e3)} 分鐘，不計入時間上限`);
        if (!killedFor && awake.awakeMs >= config.timeoutMinutes * 60e3) {
          log('超過時間上限，終止');
          killedFor = `超過 ${config.timeoutMinutes} 分鐘的時間上限`;
          child.kill('SIGTERM');
        }
      }, TICK_MS);
      let finished = false;
      const finish = (code) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        try {
          removeRunTmp(runTmp);
        } catch (error) {
          log('無法刪除暫存資料夾：', firstLine(error));
        }
        done({ code, killedFor });
      };
      child.on('error', (e) => { killedFor ??= `無法啟動 claude：${e.message}`; finish(null); });
      child.on('close', (code) => finish(code));
    });
  }

  /** 處理一件：回傳 'ok'、'aborted'（claude 非正常結束）或 'runner-error'（runner 自身的錯誤），供 shouldContinue 判斷。 */
  async function processOne(pick) {
    try {
      prepareWorktree();
      setLabels(pick.issue, ['agent:working'], ['agent:ready']);
    } catch (error) {
      runnerError(`準備 #${pick.issue} 時失敗`, error, { issue: pick.issue });
      return 'runner-error';
    }
    setBoardStatus(pick.issue, 'In progress');
    const { code, killedFor } = await runClaude(pick.issue);
    log('claude 結束，代碼', code, killedFor ? `（${killedFor}）` : '');
    if (code !== 0 || killedFor) {
      let saved;
      try {
        saved = saveWip(pick.issue);
      } catch (error) {
        saved = `保存進度失敗（${firstLine(error)}），worktree 保持原狀：${relative(ROOT, WORKTREE)}`;
      }
      log(saved);
      try {
        stopReport(pick.issue, '/work-on-issue 執行中', killedFor ?? `claude 以代碼 ${code} 結束`, `${saved}；詳見 runner 紀錄檔`);
      } catch (error) {
        runnerError(`無法在 #${pick.issue} 留停止回報`, error, { issue: pick.issue });
        return 'runner-error';
      }
      return 'aborted';
    }
    try {
      setLabels(pick.issue, [], ['agent:working']);
      const blocked = labelNames(ghJson('issue', 'view', String(pick.issue), '-R', REPO, '--json', 'labels')).includes('blocked');
      if (!blocked) setBoardStatus(pick.issue, 'Review');
    } catch (error) {
      runnerError(`#${pick.issue} 結束後更新標籤失敗`, error, { issue: pick.issue });
      return 'runner-error';
    }
    return 'ok';
  }

  const done = new Set();

  /** 重新查詢 GitHub 挑下一件（標籤可能已改變），排除本次已處理的 Issue；沒有可做的工作時回傳 null。 */
  function nextWork() {
    const prFields = 'number,title,body,headRefName,labels,comments,author';
    // gh issue list 沒有 Issue 本身的 authorAssociation，以 REST 取得（#127；清單含 PR，由 issueAssociations 排除）
    const associations = issueAssociations(
      ghJson('api', '--paginate', '--slurp', `repos/${REPO}/issues?state=open&per_page=100`).flat());
    const { candidates, skipped } = orderWork({
      fixPrs: ghJson('pr', 'list', '-R', REPO, '--state', 'open', '--label', 'changes-requested', '--author', ME, '--json', prFields),
      blockedIssues: withAssociation(
        ghJson('issue', 'list', '-R', REPO, '--state', 'open', '--label', 'blocked', '--json', 'number,title,comments,labels'),
        associations),
      blockedPrs: ghJson('pr', 'list', '-R', REPO, '--state', 'open', '--label', 'blocked', '--author', ME, '--json', prFields),
      readyIssues: withAssociation(
        ghJson('issue', 'list', '-R', REPO, '--state', 'open', '--label', 'agent:ready', '--json', 'number,title,labels,createdAt'),
        associations),
    }, { ...config, exclude: done });
    for (const s of skipped) log('略過：', s);
    if (!candidates.length) {
      log('沒有待處理的工作');
      return null;
    }
    log('候選工作（依優先順序）：');
    candidates.forEach((w, i) => log(`  ${i + 1}. [${w.kind}] Issue #${w.issue}（${w.ref}）${w.title}`));

    const openPrs = countOpenPrs(
      ghJson('pr', 'list', '-R', REPO, '--state', 'open', '--author', ME, '--json', 'number,isDraft,headRefName,author'), config);
    log(`待審 PR：${openPrs} 個（上限 ${config.maxOpenPrs}，只限制新工作）`);
    const { pick, reason } = pickWork(candidates, { openPrs, maxOpenPrs: config.maxOpenPrs });
    if (!pick) {
      log(`${reason}，不執行`);
      return null;
    }
    log(`本次會處理：[${pick.kind}] Issue #${pick.issue}`);
    return pick;
  }

  // ---- 開始 ----
  log(DRY ? '=== 試跑（不改 GitHub、不動 worktree）===' : '=== 執行 ===', REPO);
  const paused = () => existsSync(GLOBAL_PAUSE) || existsSync(PROJECT_PAUSE);
  if (existsSync(GLOBAL_PAUSE)) return log(`偵測到全機暫停（${GLOBAL_PAUSE}），本次不執行`);
  if (existsSync(PROJECT_PAUSE)) return log(`偵測到專案暫停（${relative(ROOT, PROJECT_PAUSE)}），本次不執行`);
  const [start, end] = config.hours;
  if (!DRY && !NOW && !inHours(new Date(), config.hours)) {
    return log(`不在執行時段 ${start}:00–${end}:00，本次不執行`);
  }
  if (!NOW && !canStartNew(new Date(), config)) {
    if (!DRY) return log('已過最晚開始時間，本次不開始新工作');
    log('已過最晚開始時間（排程執行時不會開始新工作）');
  }

  // 全機 lock：同一時間整台電腦只跑一個 runner
  const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  if (existsSync(GLOBAL_LOCK)) {
    const { active, lock } = lockIsActive(readFileSync(GLOBAL_LOCK, 'utf8'), isAlive);
    if (active) return log(`另一個 runner 正在執行（${lock.repo ?? '?'}，pid ${lock.pid}），本次不執行`);
    if (DRY) log('lock 存在但程序不在（試跑不清除）');
    else {
      log('清除過期的全機 lock');
      unlinkSync(GLOBAL_LOCK);
    }
  }

  // 計費保護：環境中有 API key 時不執行
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return log('偵測到 ANTHROPIC_API_KEY／ANTHROPIC_AUTH_TOKEN 環境變數：claude 會改用 API 計費。請先移除再執行，本次不執行');
  }
  gh('auth', 'status');

  // 中斷偵測：agent:working 長時間沒有更新，且目前沒有 runner 在跑
  for (const s of staleWorking(
    ghJson('issue', 'list', '-R', REPO, '--state', 'open', '--label', 'agent:working', '--json', 'number,title,updatedAt'),
    Date.now(), config.staleHours)) {
    log(`中斷的工作：#${s.number} ${s.title}（agent:working 超過 ${config.staleHours} 小時）`);
    if (DRY) continue;
    try {
      stopReport(s.number, '執行中', 'runner 執行中斷（例如電腦睡眠或關機）', `agent:working 超過 ${config.staleHours} 小時沒有更新`);
    } catch (error) {
      runnerError(`無法在中斷的 #${s.number} 留停止回報`, error, { issue: s.number });
    }
  }

  let pick = nextWork();
  if (!pick) return;

  const settings = writeSettings();
  log(`權限設定：${relative(ROOT, GENERATED_SETTINGS_FILE)}（允許 ${settings.permissions.allow.length} 條、禁止 ${settings.permissions.deny.length} 條）`);
  if (DRY) return log('試跑結束：沒有修改 GitHub、沒有建立或切換 worktree');

  // 連續處理期間一直持有全機 lock
  mkdirSync(GLOBAL_DIR, { recursive: true });
  try {
    writeFileSync(GLOBAL_LOCK, JSON.stringify({ pid: process.pid, repo: REPO, startedAt: new Date().toISOString() }), { flag: 'wx' });
  } catch {
    return log('另一個 runner 剛取得全機 lock，本次不執行');
  }
  try {
    while (pick) {
      const lastResult = await processOne(pick);
      if (lastResult !== 'runner-error') clearErrorState();
      done.add(pick.issue);
      const { go, reason } = shouldContinue({
        now: new Date(), config, processed: done.size, paused: paused(), nowMode: NOW, lastResult,
      });
      if (!go) {
        log(`結束本次處理：${reason}`);
        break;
      }
      log(`已處理 ${done.size} 件，繼續挑下一件`);
      try {
        pick = nextWork();
      } catch (error) {
        runnerError('挑選下一件時失敗', error);
        break;
      }
    }
  } finally {
    if (existsSync(GLOBAL_LOCK)) unlinkSync(GLOBAL_LOCK);
  }
}

main().catch((e) => {
  runnerError('runner 失敗', e);
  process.exitCode = 1;
});
