// 全機名額、等候的號碼牌與專案鎖（檔案操作）。判斷邏輯在 lib.mjs 的 slotTurn()、lockIsActive()。
// 都放在全機資料夾（預設 ~/.agent-runner/），不進版本控制：
//   slots/<i>.json            一個檔案＝一個名額（以 flag 'wx' 建立，同時只有一個程序能建立成功）
//   queue/<取號時間>-<pid>.json 等候名額的號碼牌
//   projects/<owner>__<name>.lock 專案鎖：同一專案同時只跑一件
// 程序已不存在（pid 不在）的名額、號碼牌與專案鎖視為過期並刪除；試跑（readSlotStatus）只讀不刪。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lockIsActive, slotTurn } from './lib.mjs';

const readJson = (file) => {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
};
const remove = (file) => { try { unlinkSync(file); } catch {} };
// 以 flag 'wx' 建立後、寫入內容前的瞬間檔案是空的：剛建立的檔案即使讀不到內容也不當作過期
export const FRESH_MS = 60e3;
const isFresh = (file) => {
  try { return Date.now() - statSync(file).mtimeMs < FRESH_MS; } catch { return false; }
};
const listJson = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /\.(json|lock)$/.test(f)).sort() : []);

/** 讀取資料夾內的項目，標出是否過期；clean 為 true 時刪除過期的項目。 */
function scan(dir, isAlive, clean) {
  return listJson(dir).flatMap((name) => {
    const file = join(dir, name);
    const content = readJson(file);
    if (content === null) return [];
    const { active: alive, lock } = lockIsActive(content, isAlive);
    const active = alive || (lock === null && isFresh(file));
    if (!active && clean) {
      remove(file);
      return [];
    }
    return [{ name, file, data: lock, stale: !active }];
  });
}

export const projectLockName = (repo) => `${repo.replace('/', '__')}.lock`;

/** 取得專案鎖。已有程序持有時回傳 { ok: false, holder }；過期的鎖先刪除。 */
export function acquireProjectLock({ dir, repo, pid, isAlive, now = new Date() }) {
  const projects = join(dir, 'projects');
  mkdirSync(projects, { recursive: true });
  const file = join(projects, projectLockName(repo));
  const holder = scan(projects, isAlive, true).find((x) => x.file === file);
  if (holder) return { ok: false, holder: holder.data };
  try {
    writeFileSync(file, JSON.stringify({ pid, repo, startedAt: now.toISOString() }), { flag: 'wx' });
  } catch {
    return { ok: false, holder: null };
  }
  return { ok: true, release: () => releaseOwned(file, pid) };
}

/** 只刪除自己持有的檔案（pid 相同），避免刪到過期清除後別人新建的。 */
function releaseOwned(file, pid) {
  const content = readJson(file);
  if (content === null) return;
  try {
    if (JSON.parse(content).pid === pid) remove(file);
  } catch {}
}

/**
 * 等候並取得一個全機名額。依號碼牌順序輪流；每 intervalMs 檢查一次。
 * abortReason() 回傳字串時放棄等候（例如 PAUSE、已過最晚開始時間）；超過 waitMs 也放棄。
 * 回傳 { ok: true, index, waitedMs, release } 或 { ok: false, reason, waitedMs }；放棄時號碼牌一定刪除。
 */
export async function waitForSlot({
  dir, slots, repo, issue = null, pid, isAlive, waitMs, intervalMs, sleep, clock = Date.now, abortReason = () => null,
  log = () => {},
}) {
  const slotDir = join(dir, 'slots');
  const queueDir = join(dir, 'queue');
  mkdirSync(slotDir, { recursive: true });
  mkdirSync(queueDir, { recursive: true });
  const started = clock();
  const me = `${String(started).padStart(15, '0')}-${pid}.json`;
  const ticket = join(queueDir, me);
  writeFileSync(ticket, JSON.stringify({ pid, repo, enqueuedAt: new Date(started).toISOString() }));
  let logged = false;
  try {
    for (;;) {
      const held = scan(slotDir, isAlive, true);
      const used = new Set(held.map((x) => Number.parseInt(x.name, 10)));
      const queue = scan(queueDir, isAlive, true).map((x) => x.name);
      const turn = slotTurn({ slots, used, queue, me });
      if (turn.canTake) {
        const file = join(slotDir, `${turn.index}.json`);
        try {
          writeFileSync(file, JSON.stringify({ pid, repo, issue, startedAt: new Date(clock()).toISOString() }), { flag: 'wx' });
          return { ok: true, index: turn.index, waitedMs: clock() - started, release: () => releaseOwned(file, pid) };
        } catch {
          continue; // 剛被別人取得，重新計算
        }
      }
      if (!logged) {
        logged = true;
        log(`等候全機名額（名額 ${slots}、排第 ${turn.position + 1} 位）；占用中：`
          + (held.map((x) => `${x.data?.repo ?? '?'}#${x.data?.issue ?? '?'}`).join('、') || '無'));
      }
      const reason = abortReason();
      if (reason) return { ok: false, reason, waitedMs: clock() - started };
      if (clock() - started >= waitMs) return { ok: false, reason: `等候超過 ${Math.round(waitMs / 60e3)} 分鐘`, waitedMs: clock() - started };
      await sleep(intervalMs);
    }
  } finally {
    remove(ticket);
  }
}

/** 試跑用：名額、號碼牌與專案鎖的現況，不刪除過期的項目。 */
export function readSlotStatus({ dir, isAlive }) {
  const read = (sub) => scan(join(dir, sub), isAlive, false).map(({ name, data, stale }) => ({ name, ...data, stale }));
  return { slots: read('slots'), queue: read('queue'), projects: read('projects') };
}
