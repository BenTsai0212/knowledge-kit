// 切換身分（#246，docs/design.md「全互動對照表」的「全域 · 切換身分」）：新身分讀到的清單少了的項目，
// 留在原本的位置模糊淡出並收合（kGone），其餘補位；不放上鎖框，也不留佔位或數量（docs/qa.md「不透露是否有看不到的文件」）。
// 消失中的項目只是切換前已在畫面上的內容，播完就移除；減少動態效果時時間是 0，直接移除。
import { MOTION, motionDuration, STAGGER, staggerIndex } from "./motion";

// kGone 的 420ms 是 expand＋fast；第 2 個起依序延後 40ms，是 stagger-sentence 的一半（motion-reference.md「時間對應的刻度」）
export const GONE_MS = MOTION.expand + MOTION.fast;
export const GONE_STAGGER = STAGGER.sentence / 2;

export interface GoneRow<T> {
  item: T;
  // 消失的順序（從 0 起，依上一份清單的順序）；仍看得到的項目為 null
  gone: number | null;
}

// 下一份清單加上消失中的項目：消失的項目放回上一份清單中的位置（緊接在它前面仍看得到的項目之後）
export function withGone<T>(previous: readonly T[], next: readonly T[], key: (item: T) => string): GoneRow<T>[] {
  const kept = new Set(next.map(key));
  const rows: GoneRow<T>[] = [];
  let j = 0;
  let order = 0;
  for (const item of previous) {
    if (!kept.has(key(item))) {
      rows.push({ item, gone: order++ });
      continue;
    }
    while (j < next.length) {
      const current = next[j++];
      rows.push({ item: current, gone: null });
      if (key(current) === key(item)) break;
    }
  }
  for (; j < next.length; j++) rows.push({ item: next[j], gone: null });
  return rows;
}

// 最後一個消失的項目播完的時間（第 7 個起與第 6 個同時）；沒有消失的項目或減少動態效果時為 0
export const goneDelay = (reduced: boolean, count: number): number =>
  count === 0 ? 0 : motionDuration(reduced, GONE_MS + staggerIndex(count - 1) * GONE_STAGGER);
