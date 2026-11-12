// 待審頁的列動態（#243 PR 3，docs/design.md「全互動對照表」的「待審」列）：
// 核准一筆時列收合（kCollapse，expand）、退回時往左淡出（kOutLeft，fast）。退場動畫要讓列留在畫面上直到結束，
// 所以先把列標成離開中、等動畫的時間到了才寫入；減少動態效果時時間是 0，立即寫入；寫入失敗時列回到原狀。
// 撤銷後回到待審的列在原位重新展開（kExpand）。
// #243 PR 4：核准全部時各列依序往右離開（kOut，間隔 stagger-list），結果彈出（kPopS，settle）；
// 說法不同的「並存」畫出等號、兩邊標上關聯，「取代」舊說法變淡、刪除線由左畫到右，動畫播完才寫入。
import type { ConflictDecision } from "../conflicts/store";
import { MOTION, motionDuration, STAGGER, staggerIndex } from "./motion";

// away：核准全部時往右離開（往圖譜方向）
export type RowExit = "collapse" | "out" | "away";

// 退場的時間：收合是 expand，往左淡出是 fast（所有退場），往右離開是 base（參考檔的 .a-out）
export const ROW_EXIT_MS: Readonly<Record<RowExit, number>> = { collapse: MOTION.expand, out: MOTION.fast, away: MOTION.base };

// count：一起離開的列數。往右離開的列依序出發，最後一列（第 7 列起與第 6 列同時）播完才寫入
export const rowExitDelay = (reduced: boolean, exit: RowExit, count = 1): number =>
  motionDuration(reduced, ROW_EXIT_MS[exit] + (exit === "away" ? staggerIndex(count - 1) * STAGGER.list : 0));

// 核准結果彈出的時間點：從按下「核准這份文件的全部」起算 420ms（motion-reference.md 延遲表「核准結果」）。
// 結果在列離開、寫入之後才出現，所以扣掉離開的時間
export const RESULT_AT_MS = MOTION.expand + 2 * STAGGER.list;
export const resultDelay = (reduced: boolean, exitMs: number): number => motionDuration(reduced, Math.max(0, RESULT_AT_MS - exitMs));

// 說法不同的決定在寫入前播完的時間：並存是最後一個關聯標示（expand + stagger-list 起升起，base），
// 取代是舊說法變淡（sweep 的一半起，base；刪除線 sweep 會先畫完）。「不是說法不同」沒有動畫
export const CONFLICT_SETTLE_MS: Readonly<Record<ConflictDecision, number>> = {
  coexist: MOTION.expand + STAGGER.list + MOTION.base,
  supersede: MOTION.sweep / 2 + MOTION.base,
  not_conflict: 0,
};

export const conflictSettleDelay = (reduced: boolean, decision: ConflictDecision): number => motionDuration(reduced, CONFLICT_SETTLE_MS[decision]);

// 往右離開的列是第幾個出發（依標記的順序，只算 away），超過 6 項不再延遲
export function exitOrder(leaving: ReadonlyMap<string, RowExit>, id: string): number {
  const away = [...leaving].filter(([, kind]) => kind === "away").map(([key]) => key);
  return staggerIndex(away.indexOf(id));
}

// 先標記離開中，等 delay 之後寫入；寫入失敗時還原標記並把錯誤往外丟（由呼叫端顯示）
export async function exitThenWrite<T>(o: { delay: number; wait(ms: number): Promise<void>; mark(): void; restore(): void; write(): Promise<T> }): Promise<T> {
  o.mark();
  try {
    if (o.delay > 0) await o.wait(o.delay);
    return await o.write();
  } catch (e) {
    o.restore();
    throw e;
  }
}

const EXIT_CLASS: Readonly<Record<RowExit, string>> = { collapse: "is-collapsing", out: "is-leaving", away: "is-away" };

// 列（li）的 class：review-item 是逐列升起；離開中與重新展開各有一個狀態
export function rowClass(id: string, leaving: ReadonlyMap<string, RowExit>, restored: ReadonlySet<string>): string {
  const exit = leaving.get(id);
  if (exit !== undefined) return `review-item ${EXIT_CLASS[exit]}`;
  return restored.has(id) ? "review-item is-restored" : "review-item";
}

// 加入或移除一批 id（離開中的列）
export function withExit(leaving: ReadonlyMap<string, RowExit>, ids: readonly string[], exit: RowExit | null): ReadonlyMap<string, RowExit> {
  const next = new Map(leaving);
  for (const id of ids) {
    if (exit === null) next.delete(id);
    else next.set(id, exit);
  }
  return next;
}
