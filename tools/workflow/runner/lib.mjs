// runner 的純邏輯：不呼叫 gh／git、不讀寫檔案，方便以 node:test 測試。
// 規則來源：憲法第 6 節「自動化 runner」、docs/workflow/modules.md「自動化」。

export const STOP_HEADINGS = ['## agent 停止', '## 計畫'];
export const DECISION_HEADING = '## 決定';
// 只採信這些身分寫的決定：公開 repo 中任何人都能留言，外部的「## 決定」不能讓 runner 無人值守執行
export const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const BILLING_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

// 與 docs/workflow/agent-workflow.md 第 0 節的正規表示式一致
const LINK = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs)\s*:?\s+#(\d+)\b/i;

/** PR 描述中 Closes／Refs 的 Issue 編號；找不到時回傳 null。 */
export function linkedIssue(body) {
  const m = LINK.exec(body ?? '');
  return m ? Number(m[1]) : null;
}

const labelNames = (x) => (x.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
const startsWith = (comment, heading) => (comment.body ?? '').trimStart().startsWith(heading);

/**
 * agent 停下之後是否已有人的「## 決定」：最後一則決定晚於最後一則停止回報或計畫。
 * plan-first 的計畫（## 計畫）也是一種停止。
 * 決定只採信 authorAssociation 為 OWNER／MEMBER／COLLABORATOR 的留言（缺少時不算）；停止回報不限制。
 */
export function hasDecision(comments = []) {
  const latest = (pred) =>
    Math.max(-1, ...comments.filter(pred).map((c) => Date.parse(c.createdAt)));
  const stop = latest((c) => STOP_HEADINGS.some((h) => startsWith(c, h)));
  const decision = latest((c) => startsWith(c, DECISION_HEADING) && TRUSTED_ASSOCIATIONS.includes(c.authorAssociation));
  return stop >= 0 && decision > stop;
}

const skippedBranch = (pr, prefixes) => prefixes.some((p) => pr.headRefName?.startsWith(p));

/**
 * 依優先順序排出候選工作。
 * 1. 修正模式：自己 PR 上的 changes-requested（PR 也帶 blocked 時須已有決定）
 * 2. 依決定繼續：帶 blocked 且已有決定的 Issue，或自己的 PR
 * 3. 新工作：agent:ready（沒有 agent:working／blocked），最舊的先做
 * agent:working 一律加在 Issue，所以 PR 都換成描述中 Closes／Refs 的 Issue；找不到時略過。
 * exclude：本次喚醒已處理過的 Issue（連續處理時不重複處理同一件）。
 */
export function orderWork(sources, { account, skipBranchPrefixes = [], exclude = new Set() }) {
  const { fixPrs = [], blockedIssues = [], blockedPrs = [], readyIssues = [] } = sources;
  const candidates = [];
  const skipped = [];
  const seen = new Set();
  const add = (item) => {
    if (seen.has(item.issue) || exclude.has(item.issue)) return;
    seen.add(item.issue);
    candidates.push(item);
  };
  const fromPr = (pr, kind) => {
    if (pr.author?.login && pr.author.login !== account) return;
    if (skippedBranch(pr, skipBranchPrefixes)) return;
    const issue = linkedIssue(pr.body);
    if (!issue) {
      skipped.push(`PR #${pr.number}：描述中找不到 Closes／Refs 的 Issue`);
      return;
    }
    add({ kind, issue, ref: `PR #${pr.number}`, title: pr.title, isNew: false });
  };

  for (const pr of fixPrs) {
    if (labelNames(pr).includes('blocked') && !hasDecision(pr.comments)) continue;
    fromPr(pr, '修正模式');
  }
  for (const it of blockedIssues) {
    if (hasDecision(it.comments)) {
      add({ kind: '依決定繼續', issue: it.number, ref: `#${it.number}`, title: it.title, isNew: false });
    }
  }
  for (const pr of blockedPrs) {
    if (hasDecision(pr.comments)) fromPr(pr, '依決定繼續');
  }
  const ready = readyIssues
    .filter((i) => !labelNames(i).some((n) => n === 'agent:working' || n === 'blocked'))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const i of ready) {
    add({ kind: '新工作', issue: i.number, ref: `#${i.number}`, title: i.title, isNew: true });
  }
  return { candidates, skipped };
}

/** 待審 PR 數：自己開的、開啟中、非 Draft，排除略過的分支前綴。 */
export function countOpenPrs(prs, { account, skipBranchPrefixes = [] }) {
  return prs.filter(
    (pr) =>
      !pr.isDraft &&
      (!pr.author?.login || pr.author.login === account) &&
      !skippedBranch(pr, skipBranchPrefixes),
  ).length;
}

/**
 * 從候選中挑一件。第一順位是新工作且待審 PR 已達上限時不接（接了會超過上限）；
 * 修正模式與依決定繼續不受上限限制。
 */
export function pickWork(candidates, { openPrs, maxOpenPrs }) {
  const pick = candidates[0];
  if (!pick) return { pick: null, reason: '沒有待處理的工作' };
  if (pick.isNew && openPrs >= maxOpenPrs) {
    return {
      pick: null,
      reason: `待審 PR 已有 ${openPrs} 個，達到上限 ${maxOpenPrs}，不接新工作`,
    };
  }
  return { pick, reason: null };
}

/** 是否在執行時段 [開始, 結束)（本機時間的小時）。 */
export function inHours(date, [start, end]) {
  const h = date.getHours();
  return h >= start && h < end;
}

const minutesOf = (date) => date.getHours() * 60 + date.getMinutes();

/** 最晚開始時間（當天第幾分鐘）：有 lastStart 時用它，否則為執行時段結束減去 timeoutMinutes。 */
export function latestStart(config) {
  if (config.lastStart) return config.lastStart[0] * 60 + config.lastStart[1];
  return config.hours[1] * 60 - config.timeoutMinutes;
}

/** 現在是否還沒過最晚開始時間（過了就不開始新工作，已在進行的會做完）。 */
export function canStartNew(date, config) {
  return minutesOf(date) <= latestStart(config);
}

export const TICK_MS = 30e3;
export const SLEEP_GAP_MS = 120e3;

/**
 * 累計醒著的時間：兩次間隔超過 SLEEP_GAP_MS 視為休眠，該段只算 TICK_MS；
 * sleptMs 是推估的休眠時間（寫進紀錄檔），沒有休眠時為 0。
 */
export function advanceAwake({ awakeMs, lastTick }, now) {
  const gap = now - lastTick;
  if (gap > SLEEP_GAP_MS) return { awakeMs: awakeMs + TICK_MS, lastTick: now, sleptMs: gap - TICK_MS };
  return { awakeMs: awakeMs + gap, lastTick: now, sleptMs: 0 };
}

export const DEFAULT_MAX_PER_RUN = 5;

/**
 * 做完一件後是否接下一件（佇列是否還有工作由呼叫端另外判斷）。
 * lastResult：'ok'（claude 正常結束，含 agent 自行停止並加 blocked）、
 * 'aborted'（claude 非正常結束：逾時、非 0、計費保護終止、啟動失敗）、'runner-error'（runner 自身的錯誤）。
 */
export function shouldContinue({ now, config, processed, paused, nowMode, lastResult }) {
  const stop = (reason) => ({ go: false, reason });
  if (lastResult === 'runner-error') return stop('runner 自身發生錯誤');
  if (lastResult === 'aborted') return stop('claude 非正常結束');
  if (nowMode) return stop('--now 只處理一件');
  const max = config.maxPerRun ?? DEFAULT_MAX_PER_RUN;
  if (processed >= max) return stop(`本次已處理 ${processed} 件，達到 maxPerRun（${max}）`);
  if (paused) return stop('偵測到 PAUSE');
  if (!inHours(now, config.hours)) return stop('不在執行時段');
  if (!canStartNew(now, config)) return stop('已過最晚開始時間');
  return { go: true, reason: null };
}

/** claude 中斷後是否需要保存進度：有未提交的修改（git status --porcelain）或未推送的 commit。 */
export function needsWipSave({ status, unpushed }) {
  return Boolean(status?.trim()) || unpushed > 0;
}

const pad = (n) => String(n).padStart(2, '0');

/** 保存進度用的分支名稱：wip/<Issue>-<YYYYMMDD-HHmm>（本機時間）。 */
export function wipBranchName(issue, date) {
  const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `wip/${issue}-${d}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** agent:working 超過 staleHours 沒有更新的 Issue。 */
export function staleWorking(issues, now, staleHours) {
  return issues.filter((i) => now - Date.parse(i.updatedAt) > staleHours * 3600e3);
}

/** 全機 lock 是否仍有效：內容可解析且 pid 仍在執行。 */
export function lockIsActive(content, isAlive) {
  let lock;
  try {
    lock = JSON.parse(content);
  } catch {
    return { active: false, lock: null };
  }
  const pid = Number(lock?.pid);
  return { active: Number.isInteger(pid) && pid > 0 && isAlive(pid), lock };
}

const REQUIRED = ['repo', 'account', 'worktree', 'hours', 'timeoutMinutes', 'staleHours', 'maxOpenPrs'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const isPosNum = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** 檢查設定檔；回傳所有問題（缺少的欄位一次列出），沒有問題時為空陣列。 */
export function validateConfig(config) {
  if (!isObj(config)) return ['設定檔必須是 JSON 物件'];
  const errors = [];
  const missing = REQUIRED.filter((k) => config[k] === undefined || config[k] === null || config[k] === '');
  if (missing.length) errors.push(`缺少必要欄位：${missing.join('、')}`);

  const has = (k) => !missing.includes(k) && config[k] !== undefined;
  if (has('repo') && !/^[\w.-]+\/[\w.-]+$/.test(String(config.repo))) errors.push('repo 必須是 owner/name');
  if (has('account') && typeof config.account !== 'string') errors.push('account 必須是字串');
  if (has('worktree') && typeof config.worktree !== 'string') errors.push('worktree 必須是字串');
  if (has('hours')) {
    const h = config.hours;
    const ok = Array.isArray(h) && h.length === 2 && h.every((n) => Number.isInteger(n) && n >= 0 && n <= 24) && h[0] < h[1];
    if (!ok) errors.push('hours 必須是 [開始, 結束]，0～24 的整數且開始小於結束');
  }
  if (has('timeoutMinutes') && !isPosNum(config.timeoutMinutes)) errors.push('timeoutMinutes 必須是正數');
  if (has('staleHours') && !isPosNum(config.staleHours)) errors.push('staleHours 必須是正數');
  if (has('maxOpenPrs') && !(Number.isInteger(config.maxOpenPrs) && config.maxOpenPrs >= 1)) {
    errors.push('maxOpenPrs 必須是 1 以上的整數');
  }
  if (config.maxPerRun !== undefined && !(Number.isInteger(config.maxPerRun) && config.maxPerRun >= 1)) {
    errors.push('maxPerRun 必須是 1 以上的整數');
  }
  if (config.lastStart !== undefined) {
    const t = config.lastStart;
    const ok = Array.isArray(t) && t.length === 2 && Number.isInteger(t[0]) && Number.isInteger(t[1]) &&
      t[0] >= 0 && t[0] <= 24 && t[1] >= 0 && t[1] <= 59;
    if (!ok) errors.push('lastStart 必須是 [時, 分]，時為 0～24、分為 0～59 的整數');
    else if (!errors.some((e) => e.startsWith('hours')) && Array.isArray(config.hours) &&
      t[0] * 60 + t[1] > config.hours[1] * 60) {
      errors.push('lastStart 不能晚於執行時段結束（hours 的結束時間）');
    }
  }

  if (config.board !== undefined && config.board !== null) {
    const b = config.board;
    if (!isObj(b) || typeof b.owner !== 'string' || !Number.isInteger(b.number)) {
      errors.push('board 必須是 { "owner": 字串, "number": 整數 } 或 null');
    }
  }
  if (config.env !== undefined) {
    if (!isObj(config.env) || !Object.values(config.env).every((v) => typeof v === 'string')) {
      errors.push('env 必須是字串值的物件');
    } else {
      const billing = BILLING_ENV.filter((k) => k in config.env);
      if (billing.length) errors.push(`env 不能包含 ${billing.join('、')}（會改用 API 計費）`);
    }
  }
  for (const k of ['agentNotes', 'skipBranchPrefixes', 'extraAllow', 'extraAllowedDomains', 'sandboxExcludedCommands']) {
    if (config[k] !== undefined && !isStrArray(config[k])) errors.push(`${k} 必須是字串陣列`);
  }
  if (config.logDir !== undefined && typeof config.logDir !== 'string') errors.push('logDir 必須是字串');
  return errors;
}

/**
 * 以共用設定為基礎，加入專案相關的值，產生傳給 claude --settings 的權限設定。
 * 不修改 base。
 */
export function buildSettings(base, { repoRoot, config }) {
  const s = structuredClone(base);
  s.permissions.allow = [...s.permissions.allow, ...(config.extraAllow ?? [])];
  s.sandbox.excludedCommands = [...(s.sandbox.excludedCommands ?? []), ...(config.sandboxExcludedCommands ?? [])];
  s.sandbox.network.allowedDomains = [...s.sandbox.network.allowedDomains, ...(config.extraAllowedDomains ?? [])];
  // worktree 的 git 資料在主 repo 的 .git 內（commit、branch 都會寫入）
  s.sandbox.filesystem.allowWrite = [`${repoRoot}/.git`, ...s.sandbox.filesystem.allowWrite];
  return s;
}

/** 給 agent 的補充說明（--append-system-prompt），只在 runner 執行時附加。 */
export function agentNote(config) {
  return [
    '你正在 runner 專用的 git worktree 中無人值守執行。',
    '- main 分支可能被主資料夾佔用：不要 git switch main，直接從 origin/main 開分支，例如 git fetch origin && git switch -c <分支> origin/main。',
    '- gh 已設定好 GH_TOKEN 與 SSL_CERT_FILE，直接使用 gh 即可。',
    '- 不能寫入 .git/config：不要用 git push -u、git branch --set-upstream-to 或 gh pr checkout。',
    '- 推送一律用 git push origin HEAD:<分支>，直接寫明目標分支，不要先 cd 再推送：無法判斷目標分支時，合併確認 hook 會要求確認，在無人值守下等同拒絕。',
    '- 修正模式：用 runner 專屬的本地分支，git fetch origin <分支> && git switch -c runner/<分支> origin/<分支>；推送方式同上，rebase 後用 git push --force-with-lease origin HEAD:<分支>。runner 開始前已清除舊的 runner/* 本地分支，不需要也不能使用 git reset --hard。',
    '- 不自行啟動瀏覽器（Chrome、Playwright 等）或架設效能測量環境；需要的項目列在 PR 的人工待辦。',
    '- 可能長時間執行的指令，用 Bash 工具的 timeout 參數設定上限；不要在背景執行可能卡住的指令；不需要在 PR 回報。',
    ...(config.agentNotes ?? []).map((n) => `- ${n}`),
  ].join('\n');
}

/** runner 自己留的停止回報（格式同 docs/workflow/agent-workflow.md「停止時的回報」）。 */
export function stopReportBody({ step, reason, facts, account, logPath }) {
  return [
    `## agent 停止：${reason}`,
    '',
    `- **停在哪一步**：${step}`,
    `- **原因**：${reason}`,
    `- **已確認的事實**：${facts}`,
    '- **可行的選項**：',
    '  1. 查看 runner 紀錄後，以 `## 決定` 留言指示如何繼續（agent 建議）',
    '  2. 移除 `blocked` 並重新加上 `agent:ready`，讓 runner 重試',
    `- **需要誰決定**：@${account}`,
    '',
    `（由本機 agent runner 留言；紀錄檔：\`${logPath}\`）`,
  ].join('\n');
}
