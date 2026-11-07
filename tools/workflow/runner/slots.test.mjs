import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireProjectLock, cooldownFile, FRESH_MS, readCooldown, readSlotStatus, waitForSlot, writeCooldown,
} from './slots.mjs';

// 每個測試用自己的暫存資料夾；pid 是假的，以 alive 集合決定程序是否存在；時鐘與 sleep 也是假的，不實際等候
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'runner-slots-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const alive = new Set([1, 2, 3, 4]);
  let now = 1_000_000;
  const env = {
    dir, alive, isAlive: (pid) => alive.has(pid), clock: () => now, advance: (ms) => { now += ms; },
    sleeps: [], waitMs: 30 * 60e3, intervalMs: 30e3,
  };
  env.sleep = async (ms) => { env.sleeps.push(ms); now += ms; await env.onSleep?.(); };
  return env;
}
const opts = (env, extra) => ({
  dir: env.dir, slots: 2, repo: 'o/a', pid: 1, isAlive: env.isAlive, waitMs: env.waitMs, intervalMs: env.intervalMs,
  sleep: env.sleep, clock: env.clock, ...extra,
});
const files = (env, sub) => (existsSync(join(env.dir, sub)) ? readdirSync(join(env.dir, sub)).sort() : []);
const hold = (env, index, pid, repo = 'o/x') => {
  mkdirSync(join(env.dir, 'slots'), { recursive: true });
  writeFileSync(join(env.dir, 'slots', `${index}.json`), JSON.stringify({ pid, repo, issue: 9 }));
};

test('名額：有空位時立即取得，交還後檔案刪除；號碼牌不留下', async (t) => {
  const env = setup(t);
  const a = await waitForSlot(opts(env, { issue: 5 }));
  assert.equal(a.ok, true);
  assert.equal(a.index, 0);
  assert.equal(a.waitedMs, 0);
  assert.equal(a.waited, false, '立即取得時不重新挑選工作');
  const b = await waitForSlot(opts(env, { pid: 2, repo: 'o/b' }));
  assert.equal(b.index, 1);
  assert.deepEqual(files(env, 'slots'), ['0.json', '1.json']);
  assert.deepEqual(files(env, 'queue'), []);
  a.release();
  assert.deepEqual(files(env, 'slots'), ['1.json']);
  b.release();
  assert.deepEqual(files(env, 'slots'), []);
});

test('名額：只刪除自己的名額（pid 不同時 release 不刪）', async (t) => {
  const env = setup(t);
  const a = await waitForSlot(opts(env));
  hold(env, 0, 2); // 假設過期清除後被別的程序重新取得
  a.release();
  assert.deepEqual(files(env, 'slots'), ['0.json']);
});

test('過期名額清除：pid 不存在的名額刪除後可取得；剛建立、還沒有內容的不算過期', async (t) => {
  const env = setup(t);
  hold(env, 0, 99);
  hold(env, 1, 98);
  const a = await waitForSlot(opts(env));
  assert.equal(a.ok, true);
  assert.deepEqual(files(env, 'slots'), [`${a.index}.json`]);

  writeFileSync(join(env.dir, 'slots', '1.json'), ''); // 別人以 wx 建立、尚未寫入
  const b = await waitForSlot(opts(env, { pid: 2, waitMs: 0 }));
  assert.equal(b.ok, false, '空的新檔案視為占用');
  const old = (Date.now() - FRESH_MS * 2) / 1e3;
  utimesSync(join(env.dir, 'slots', '1.json'), old, old);
  const c = await waitForSlot(opts(env, { pid: 2 }));
  assert.equal(c.ok, true, '空檔案超過 FRESH_MS 才視為過期');
});

test('等候後取得：占用者交還後取得，記錄等候時間與排隊位置', async (t) => {
  const env = setup(t);
  hold(env, 0, 3);
  hold(env, 1, 4);
  const logs = [];
  env.onSleep = () => { if (env.sleeps.length === 2) env.alive.delete(3); };
  const r = await waitForSlot(opts(env, { log: (m) => logs.push(m) }));
  assert.equal(r.ok, true);
  assert.equal(r.index, 0);
  assert.equal(r.waitedMs, 60e3);
  assert.equal(r.waited, true, '實際等候過時重新挑選工作');
  assert.deepEqual(env.sleeps, [30e3, 30e3]);
  assert.match(logs[0], /等候全機名額（名額 2、排第 1 位）；占用中：o\/x#9、o\/x#9/);
});

test('等候逾時：超過上限就放棄，號碼牌刪除', async (t) => {
  const env = setup(t);
  hold(env, 0, 3);
  hold(env, 1, 4);
  const r = await waitForSlot(opts(env, { waitMs: 90e3 }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /等候超過/);
  assert.equal(r.waitedMs, 90e3);
  assert.deepEqual(files(env, 'queue'), []);
});

test('放棄等候：abortReason（例如 PAUSE）回傳理由時立即放棄', async (t) => {
  const env = setup(t);
  hold(env, 0, 3);
  hold(env, 1, 4);
  const r = await waitForSlot(opts(env, { abortReason: () => '偵測到 PAUSE' }));
  assert.deepEqual([r.ok, r.reason, env.sleeps.length], [false, '偵測到 PAUSE', 0]);
});

test('公平輪流：排在前面的號碼牌先取得；做完重新取號會排到後面', async (t) => {
  const env = setup(t);
  hold(env, 0, 3);
  hold(env, 1, 4);
  mkdirSync(join(env.dir, 'queue'), { recursive: true });
  writeFileSync(join(env.dir, 'queue', `${String(1).padStart(15, '0')}-2.json`), JSON.stringify({ pid: 2, repo: 'o/b' }));
  env.onSleep = () => env.alive.delete(3); // 空出一個名額，但排第 1 位的是 pid 2
  const r = await waitForSlot(opts(env, { waitMs: 60e3 }));
  assert.equal(r.ok, false, '空出的一個名額留給先排隊的');
  assert.deepEqual(files(env, 'queue').length, 1, '只剩別人的號碼牌');
});

test('同專案不重複執行：專案鎖由存在的程序持有時不能取得；過期時清除', (t) => {
  const env = setup(t);
  const a = acquireProjectLock({ dir: env.dir, repo: 'o/a', pid: 1, isAlive: env.isAlive });
  assert.equal(a.ok, true);
  const b = acquireProjectLock({ dir: env.dir, repo: 'o/a', pid: 2, isAlive: env.isAlive });
  assert.equal(b.ok, false);
  assert.equal(b.holder.pid, 1);
  assert.equal(acquireProjectLock({ dir: env.dir, repo: 'o/b', pid: 2, isAlive: env.isAlive }).ok, true, '其他專案不受影響');
  env.alive.delete(1);
  const c = acquireProjectLock({ dir: env.dir, repo: 'o/a', pid: 3, isAlive: env.isAlive });
  assert.equal(c.ok, true, '持有者已不存在時清除');
  c.release();
  assert.deepEqual(files(env, 'projects'), ['o__b.lock']);
});

test('readSlotStatus：列出名額、號碼牌與專案鎖，標出過期但不刪除', (t) => {
  const env = setup(t);
  hold(env, 0, 1, 'o/a');
  hold(env, 1, 99, 'o/b');
  acquireProjectLock({ dir: env.dir, repo: 'o/a', pid: 1, isAlive: env.isAlive });
  const s = readSlotStatus({ dir: env.dir, isAlive: env.isAlive });
  assert.deepEqual(s.slots.map((x) => [x.name, x.repo, x.stale]), [['0.json', 'o/a', false], ['1.json', 'o/b', true]]);
  assert.deepEqual(s.projects.map((x) => x.repo), ['o/a']);
  assert.deepEqual(s.queue, []);
  assert.deepEqual(files(env, 'slots'), ['0.json', '1.json']);
});

test('waited：立即取得時即使時鐘已前進也是 false', async (t) => {
  const env = setup(t);
  const clock = () => { env.advance(5); return env.clock(); }; // 每次讀取時鐘都經過一點時間
  const r = await waitForSlot(opts(env, { clock }));
  assert.equal(r.ok, true);
  assert.ok(r.waitedMs > 0);
  assert.equal(r.waited, false);
});

test('冷卻檔：寫入後有效，恢復時間過後失效並可清除；已有較晚的恢復時間時保留', (t) => {
  const env = setup(t);
  const now = new Date('2026-11-07T00:00:00Z');
  const until = new Date('2026-11-07T02:00:00Z');
  writeCooldown({ dir: env.dir, until, reason: '訂閱額度用完', repo: 'o/a', issue: 5, now });
  assert.equal(readCooldown({ dir: env.dir, now }).until.getTime(), until.getTime());
  const kept = writeCooldown({ dir: env.dir, until: new Date('2026-11-07T01:00:00Z'), reason: 'y', repo: 'o/b', issue: 6, now });
  assert.equal(kept.until.getTime(), until.getTime(), '保留較晚的恢復時間');
  assert.equal(readCooldown({ dir: env.dir, now }).repo, 'o/a');
  const later = new Date('2026-11-07T03:00:00Z');
  assert.equal(readCooldown({ dir: env.dir, now: later }), null);
  assert.ok(existsSync(cooldownFile(env.dir)), '只讀不刪');
  readCooldown({ dir: env.dir, now: later, clean: true });
  assert.equal(existsSync(cooldownFile(env.dir)), false);
});

test('冷卻中不啟動：有空的名額也不取得；等候期間開始冷卻時放棄', async (t) => {
  const env = setup(t);
  const coolingDown = () => (readCooldown({ dir: env.dir, now: new Date(env.clock()) }) ? '全機冷卻中' : null);
  const cool = () => {
    const now = new Date(env.clock());
    writeCooldown({ dir: env.dir, until: new Date(now.getTime() + 3600e3), reason: '訂閱額度用完', repo: 'o/b', now });
  };
  cool();
  const r = await waitForSlot(opts(env, { abortReason: coolingDown }));
  assert.deepEqual([r.ok, r.reason, files(env, 'slots')], [false, '全機冷卻中', []], '名額空著也不取得');
  readCooldown({ dir: env.dir, now: new Date(env.clock() + 7200e3), clean: true });

  hold(env, 0, 3);
  hold(env, 1, 4);
  env.onSleep = cool; // 等候中別的 runner 偵測到額度用完
  const w = await waitForSlot(opts(env, { abortReason: coolingDown }));
  assert.deepEqual([w.ok, w.reason, w.waited], [false, '全機冷卻中', true]);
  assert.deepEqual(files(env, 'queue'), []);
});
