// 待審頁的列動態（#243 PR 3，docs/design.md「全互動對照表」的「待審」列）：
// 核准一筆時列收合（kCollapse，expand）、退回時往左淡出（kOutLeft，fast）。退場動畫要讓列留在畫面上直到結束，
// 所以先把列標成離開中、等動畫的時間到了才寫入；減少動態效果時時間是 0，立即寫入；寫入失敗時列回到原狀。
// 撤銷後回到待審的列在原位重新展開（kExpand）。
import { MOTION, motionDuration } from "./motion";

export type RowExit = "collapse" | "out";

// 退場的時間：收合是 expand，往左淡出是 fast（所有退場）
export const ROW_EXIT_MS: Readonly<Record<RowExit, number>> = { collapse: MOTION.expand, out: MOTION.fast };

export const rowExitDelay = (reduced: boolean, exit: RowExit): number => motionDuration(reduced, ROW_EXIT_MS[exit]);

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

// 列（li）的 class：review-item 是逐列升起；離開中與重新展開各有一個狀態
export function rowClass(id: string, leaving: ReadonlyMap<string, RowExit>, restored: ReadonlySet<string>): string {
  const exit = leaving.get(id);
  if (exit !== undefined) return exit === "collapse" ? "review-item is-collapsing" : "review-item is-leaving";
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
