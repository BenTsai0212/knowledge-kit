// 人的理解的顯示（ADR 0012 決定 5、6，docs/qa.md「人的理解的顯示」）：回答卡片與原文欄的「記錄」。
// 讀到的理解已經過 RLS（兩段都看得到才讀得到）；「先作答才看得到同事的理解」由這裡判斷：自己還沒留下理解、也沒略過這一組時不顯示別人的。
import type { Interpretation } from "../conflicts/interpretations";

// 一組兩段的鍵，順序不拘（略過的記錄與原文欄的比對共用）
export const pairKey = (a: string, b: string) => [a, b].sort().join("\u0000");

// 這一組（兩段，順序不拘）的理解
export const pairRecords = (items: readonly Interpretation[], a: string, b: string): Interpretation[] =>
  items.filter((i) => pairKey(i.passageA, i.passageB) === pairKey(a, b));

export interface RecordRows {
  mine: Interpretation[];
  // 同事的理解：locked 時一律為空
  peers: Interpretation[];
  // 還沒作答也沒略過
  locked: boolean;
}

// items 是同一組的理解；skipped：本次工作階段已略過這一組
export function recordRows(items: readonly Interpretation[], skipped: boolean): RecordRows {
  const mine = items.filter((i) => i.mine);
  const locked = mine.length === 0 && !skipped;
  return { mine, peers: locked ? [] : items.filter((i) => !i.mine), locked };
}
