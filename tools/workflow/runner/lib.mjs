// runner 的純邏輯：不呼叫 gh／git、不讀寫檔案，方便以 node:test 測試。
// 規則來源：憲法第 6 節「自動化 runner」、docs/workflow/modules.md「自動化」。
import { checkSensitiveContent } from '../check-post-body.mjs';
import { PERSONAL_PATH } from '../../../scripts/check-sensitive.mjs';

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

/** 作者是否為可信身分；缺少 authorAssociation 時不算。 */
export const isTrusted = (item) => TRUSTED_ASSOCIATIONS.includes(item?.authorAssociation);

/**
 * 只保留可信身分的項目（留言、審查、review comment）；skipped 只是筆數，不保留內容（#127）。
 * 非可信身分的文字不進入 agent 的上下文，避免藉留言影響 agent（prompt injection）。
 */
export function trustedOnly(items = []) {
  const trusted = items.filter(isTrusted);
  return { trusted, skipped: items.length - trusted.length };
}

/**
 * REST 的 Issue 清單（repos/<repo>/issues）→ Map<編號, authorAssociation>。
 * gh issue list 沒有 Issue 本身的身分，所以由 REST 取得；REST 的清單含 PR（帶 pull_request），先排除。
 */
export function issueAssociations(restIssues = []) {
  return new Map(restIssues.filter((i) => !i.pull_request).map((i) => [i.number, i.author_association ?? null]));
}

/** 把 issueAssociations() 的身分併入 gh issue list 的結果；查不到時是 null（視為非可信）。 */
export const withAssociation = (issues = [], associations) =>
  issues.map((i) => ({ ...i, authorAssociation: associations.get(i.number) ?? null }));

/**
 * agent 停下之後是否已有人的「## 決定」：最後一則決定晚於最後一則停止回報或計畫。
 * plan-first 的計畫（## 計畫）也是一種停止。
 * 決定只採信 authorAssociation 為 OWNER／MEMBER／COLLABORATOR 的留言（缺少時不算）；停止回報不限制。
 */
export function hasDecision(comments = []) {
  const latest = (pred) =>
    Math.max(-1, ...comments.filter(pred).map((c) => Date.parse(c.createdAt)));
  const stop = latest((c) => STOP_HEADINGS.some((h) => startsWith(c, h)));
  const decision = latest((c) => startsWith(c, DECISION_HEADING) && isTrusted(c));
  return stop >= 0 && decision > stop;
}

const skippedBranch = (pr, prefixes) => prefixes.some((p) => pr.headRefName?.startsWith(p));

/**
 * 依優先順序排出候選工作。
 * 1. 修正模式：自己 PR 上的 changes-requested（PR 也帶 blocked 時須已有決定）
 * 2. 依決定繼續：帶 blocked 且已有決定的 Issue，或自己的 PR
 * 3. 新工作：agent:ready（沒有 agent:working／blocked），最舊的先做
 * 2、3 的 Issue 須由可信身分開立（authorAssociation，缺少時不派工）。
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
  // Issue 本文等於給 agent 的指示：作者不是可信身分時不派工（#127；外部 Issue 由決策中心另開）
  const trustedIssue = (i) => {
    if (isTrusted(i)) return true;
    skipped.push(`Issue #${i.number}：作者不是可信身分（${i.authorAssociation ?? '不明'}），不派工`);
    return false;
  };
  for (const it of blockedIssues) {
    if (hasDecision(it.comments) && trustedIssue(it)) {
      add({ kind: '依決定繼續', issue: it.number, ref: `#${it.number}`, title: it.title, isNew: false });
    }
  }
  for (const pr of blockedPrs) {
    if (hasDecision(pr.comments)) fromPr(pr, '依決定繼續');
  }
  const ready = readyIssues
    .filter((i) => !labelNames(i).some((n) => n === 'agent:working' || n === 'blocked'))
    .filter(trustedIssue)
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
  if (lastResult === 'quota') return stop('訂閱額度用完，全機冷卻中');
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

// 每次執行專屬的暫存資料夾放在 worktree 內（已在 .gitignore），sandbox 本來就能寫入（#104）
export const RUN_TMP_DIR = '.runner-tmp';
const RUN_TMP_NAME = /^\d{8}T\d{6}-\d+$/;

/** 本次執行的暫存資料夾：<worktree>/.runner-tmp/<YYYYMMDDTHHmmss>-<Issue>（本機時間）。 */
export function runTmpDir(worktree, issue, date) {
  const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${worktree.replace(/\/+$/, '')}/${RUN_TMP_DIR}/${d}T${t}-${issue}`;
}

/** 刪除前的確認：只接受 runTmpDir 產生的路徑（<worktree>/.runner-tmp/ 底下一層、名稱符合格式）。 */
export function isRunTmpDir(worktree, dir) {
  const prefix = `${worktree.replace(/\/+$/, '')}/${RUN_TMP_DIR}/`;
  return typeof dir === 'string' && dir.startsWith(prefix) && RUN_TMP_NAME.test(dir.slice(prefix.length));
}

/** 傳給 agent 的環境變數：check-post-body.mjs 依 RUNNER_RUN_TMP、RUNNER_RUN_STARTED 檢查；TMPDIR 也指過去，但不依賴它生效。 */
export function runTmpEnv(dir, startedAt) {
  return { RUNNER_RUN_TMP: dir, RUNNER_RUN_STARTED: startedAt.toISOString(), TMPDIR: dir };
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

export const DEFAULT_SLOTS = 2;
export const DEFAULT_SLOT_WAIT_MINUTES = 30;
export const SLOT_POLL_MS = 30e3;

/**
 * 全機名額的輪替（公平輪流）：號碼牌依名稱（取號時間）排序，只有排在前 free 位的可以取得名額。
 * used：已被占用的名額編號；queue：所有有效的號碼牌名稱；me：自己的號碼牌。
 * 做完一件就交還名額、重新取號，所以會排到其他等候者之後。
 */
export function slotTurn({ slots, used, queue, me }) {
  // 名額數調小時，編號超出範圍的名額仍占用容量
  const freeIndexes = Array.from({ length: slots }, (_, i) => i).filter((i) => !used.has(i))
    .slice(0, Math.max(0, slots - used.size));
  const position = [...queue].sort().indexOf(me);
  const canTake = position >= 0 && position < freeIndexes.length;
  return { canTake, position, free: freeIndexes.length, index: canTake ? freeIndexes[0] : null };
}

/** 全機設定（~/.agent-runner/config.json）：目前只有 slots；不存在時用預設值。回傳 { slots, error }。 */
export function globalSlots(config) {
  if (config === null || config === undefined || config.slots === undefined) return { slots: DEFAULT_SLOTS, error: null };
  if (!Number.isInteger(config.slots) || config.slots < 1) return { slots: null, error: 'slots 必須是 1 以上的整數' };
  return { slots: config.slots, error: null };
}

/**
 * claude 的 stream-json 輸出（逐段收到的資料）→ 逐行解析。只處理收到換行的完整行；
 * 最後一段沒有換行的資料在 end()（stdout 結束）時處理一次。半行不會被當成一整行解析（dev-workflow-template#70 修正要求）。
 * push()／end() 回傳新出現的計費方式檢查結果（第一個 init 行）：
 *   { apiKeySource }（可解析，'none' 表示使用訂閱帳號）或 { apiKeySource: null, error: true }（無法解析）。
 * state 保留額度判斷要用的最後一個 rate_limit_event 與 result 的 is_error（detectQuotaExhausted）。
 */
export function streamTracker() {
  let pending = '';
  const state = { checkedAuth: false, lastRateLimit: null, resultIsError: false };
  const handle = (line, found) => {
    if (line.includes('"type":"rate_limit_event"')) {
      try { state.lastRateLimit = JSON.parse(line); } catch {}
    } else if (line.includes('"type":"result"')) {
      try { state.resultIsError = JSON.parse(line).is_error === true; } catch {}
    } else if (!state.checkedAuth && line.includes('"subtype":"init"')) {
      state.checkedAuth = true;
      try {
        found.push({ apiKeySource: JSON.parse(line).apiKeySource ?? null });
      } catch {
        found.push({ apiKeySource: null, error: true });
      }
    }
  };
  return {
    state,
    push(chunk) {
      const found = [];
      const lines = (pending + chunk).split('\n');
      pending = lines.pop();
      for (const line of lines) handle(line, found);
      return found;
    },
    end() {
      const found = [];
      if (pending) handle(pending, found);
      pending = '';
      return found;
    },
  };
}

export const QUOTA_STATUSES = ['rejected', 'rate_limited'];
const QUOTA_MAX_MS = 7 * 24 * 3600e3;

/**
 * claude 是否因訂閱額度用完而結束（嚴格條件，任一不成立就回傳 null，維持現行的異常結束處理）：
 * runner 沒有主動終止（逾時、計費保護）；claude 非 0 結束或 result 的 is_error 為 true；
 * 最後一個 rate_limit_event 的 status 是 rejected／rate_limited；resetsAt 在未來 7 天內（大於 1e12 時當作毫秒）。
 * stream-json 的 rate_limit_event 沒有官方規格，status 的值曾經改變，所以只認這幾個值（dev-workflow-template#66 決定）。
 * 成立時回傳 { until: Date, status, rateLimitType }。
 */
export function detectQuotaExhausted({ code, killedFor, resultIsError, lastRateLimit, now }) {
  if (killedFor) return null;
  if (code === 0 && !resultIsError) return null;
  const info = lastRateLimit?.rate_limit_info;
  if (!info || !QUOTA_STATUSES.includes(info.status)) return null;
  const raw = Number(info.resetsAt);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const until = new Date(raw > 1e12 ? raw : raw * 1e3);
  const ahead = until.getTime() - now.getTime();
  if (ahead <= 0 || ahead > QUOTA_MAX_MS) return null;
  return { until, status: info.status, rateLimitType: info.rateLimitType ?? null };
}

/** 全機冷卻檔（~/.agent-runner/cooldown.json）的內容是否仍有效；內容錯誤或時間已過時回傳 null。 */
export function activeCooldown(content, now) {
  try {
    const c = JSON.parse(content);
    const until = new Date(c.until);
    return until.getTime() > now.getTime() ? { ...c, until } : null;
  } catch {
    return null;
  }
}

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
  if (config.slotWaitMinutes !== undefined && !isPosNum(config.slotWaitMinutes)) errors.push('slotWaitMinutes 必須是正數');
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
export function agentNote(config, { runTmp } = {}) {
  return [
    '你正在 runner 專用的 git worktree 中無人值守執行。',
    '- main 分支可能被主資料夾佔用：不要 git switch main，直接從 origin/main 開分支，例如 git fetch origin && git switch -c <分支> origin/main。',
    '- gh 已設定好 GH_TOKEN 與 SSL_CERT_FILE，直接使用 gh 即可。',
    '- 不能寫入 .git/config：不要用 git push -u、git branch --set-upstream-to 或 gh pr checkout。',
    '- 推送一律用 git push origin HEAD:<分支>，直接寫明目標分支，不要先 cd 再推送：無法判斷目標分支時，合併確認 hook 會要求確認，在無人值守下等同拒絕。',
    '- 修正模式：用 runner 專屬的本地分支，git fetch origin <分支> && git switch -c runner/<分支> origin/<分支>；推送方式同上，rebase 後用 git push --force-with-lease origin HEAD:<分支>。runner 開始前已清除舊的 runner/* 本地分支，不需要也不能使用 git reset --hard。',
    '- 不自行啟動瀏覽器（Chrome、Playwright 等）或架設效能測量環境；需要的項目列在 PR 的人工待辦。',
    '- 可能長時間執行的指令，用 Bash 工具的 timeout 參數設定上限；不要在背景執行可能卡住的指令；不需要在 PR 回報。',
    ...(runTmp ? [
      `- PR 描述與留言的檔案一律用 Write 工具寫在本次執行的暫存資料夾 ${runTmp}/ 底下（環境變數 RUNNER_RUN_TMP；不要用 $TMPDIR 或 /tmp，那裡有其他專案的同名檔案）。`
        + '寫入失敗時不執行 gh；先以 node tools/workflow/check-post-body.mjs 檢查，通過後用同一個路徑 --body-file 貼出（docs/workflow/agent-workflow.md「貼出 PR 描述與留言」）。',
    ] : []),
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

// ---- 穩定性（dev-workflow-template#45）----

// gh 暫時性錯誤：連線中斷、unexpected EOF、HTTP 5xx、逾時。權限、參數、404 等不重試。
const TRANSIENT_GH = [
  /unexpected EOF/i,
  /connection (?:reset|refused|closed|aborted)/i,
  /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EAI_AGAIN)\b/,
  /\bHTTP 5\d\d\b/i,
  /\b5\d\d (?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)\b/i,
  /\b(?:i\/o timeout|TLS handshake timeout|context deadline exceeded|timed? ?out)\b/i,
];
// 錯誤訊息同時出現這些時，不視為暫時性（例如 404 的說明裡剛好有 timeout 字樣）
const PERMANENT_GH = [/\bHTTP 4\d\d\b/i, /\b(?:401|403|404|422) (?:Unauthorized|Forbidden|Not Found|Unprocessable)/i];

/** 等待後重試一次的間隔。 */
export const GH_RETRY_MS = 10e3;

/** gh 的錯誤是否為暫時性（值得等待後重試一次）。text 是錯誤訊息、stderr 與錯誤代碼合併的文字。 */
export function isTransientGhError(text) {
  const s = String(text ?? '');
  if (PERMANENT_GH.some((r) => r.test(s))) return false;
  return TRANSIENT_GH.some((r) => r.test(s));
}

/** 移除標籤後讀回：仍存在的標籤（current 是讀回的標籤名稱）。 */
export function remainingLabels(current, removed) {
  return removed.filter((l) => current.includes(l));
}

/** 同一錯誤連續幾次後在 Issue 留 `## runner 提醒`。 */
export const REMIND_AFTER = 3;
export const REMINDER_HEADING = '## runner 提醒';

/**
 * 記錄一次 runner 自身的錯誤。同一個錯誤 = 同一階段＋同一個訊息首行；不同錯誤從 1 重新計算。
 * 回傳 { state, remind }：連續 REMIND_AFTER 次、與 Issue 有關、且這個錯誤尚未提醒過時 remind 為 true。
 * state 由呼叫端存進狀態檔；成功一次後由呼叫端清除（null）。
 */
export function recordRunnerError(state, { stage, message, issue = null }, remindAfter = REMIND_AFTER) {
  const first = String(message ?? '').split('\n')[0];
  const same = state && state.stage === stage && state.message === first;
  const next = {
    stage, message: first, issue: issue ?? null,
    count: same ? state.count + 1 : 1,
    reminded: same ? Boolean(state.reminded) : false,
  };
  const remind = next.issue != null && next.count >= remindAfter && !next.reminded;
  if (remind) next.reminded = true;
  return { state: next, remind };
}

/** `## runner 提醒` 的內容：錯誤摘要、次數、紀錄檔位置、建議的處理；不加或移除標籤，不影響 `## 決定`。 */
export function runnerReminderBody({ stage, message, count, logPath }) {
  return [
    `${REMINDER_HEADING}：同一個錯誤已連續 ${count} 次`,
    '',
    `- **階段**：${stage}`,
    `- **錯誤**：${message}`,
    `- **次數**：連續 ${count} 次`,
    `- **紀錄檔**：\`${logPath}\``,
    '- **建議的處理**：查看紀錄檔找出原因並排除（例如清理 runner worktree 中未提交的變更、確認 gh 登入狀態），runner 會在下次執行時再試；成功一次後計數歸零。',
    '',
    '（由本機 agent runner 留言；這則提醒不改標籤，也不影響 `## 決定` 的判斷。同一個錯誤不重複提醒。）',
  ].join('\n');
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 已知路徑之外的個人路徑：連同後面的路徑一起遮蔽（後面的資料夾名稱也可能是私人的）
const OTHER_PERSONAL_PATH = new RegExp(`${PERSONAL_PATH.source}(?:/[^\\s'"\`，。、：；（）「」()]*)?`, 'g');

/**
 * 遮蔽文字中的本機絕對路徑：worktree → `<worktree>`、repo 根目錄 → `<repo>`、家目錄 → `~`；
 * 其餘 /Users/<名稱>、/home/<名稱> 形式的路徑換成 `<路徑>`（/home/runner 依 PERSONAL_PATH 不算）。
 * 已知路徑由長到短替換，worktree 在 repo 或家目錄底下時也遮蔽成 `<worktree>`。
 */
export function maskLocalPaths(text, { worktree, repoRoot, home } = {}) {
  const known = [[worktree, '<worktree>'], [repoRoot, '<repo>'], [home, '~']]
    .filter(([p]) => p && p !== '/')
    .map(([p, label]) => [p.replace(/\/+$/, ''), label])
    .sort((a, b) => b[0].length - a[0].length);
  let out = String(text ?? '');
  for (const [p, label] of known) {
    out = out.replace(new RegExp(`${escapeRegExp(p)}(?![\\w.-])`, 'g'), label);
  }
  return out.replace(OTHER_PERSONAL_PATH, '<路徑>');
}

/**
 * 要貼出的 `## runner 提醒`：階段與錯誤先遮蔽本機路徑，再以 check-post-body.mjs 的規則檢查。
 * 仍有 email 或個人路徑時 body 為 null（不貼出，只寫紀錄與通知），errors 只含行號與種類。
 */
export function runnerReminder({ stage, message, count, logPath }, paths = {}) {
  const body = runnerReminderBody({
    stage: maskLocalPaths(stage, paths), message: maskLocalPaths(message, paths), count, logPath,
  });
  const errors = checkSensitiveContent(body);
  return { body: errors.length ? null : body, errors };
}
