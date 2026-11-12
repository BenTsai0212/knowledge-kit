// 手機的原文面板（#256，docs/design.md「問答（手機）」）：「出處 N／M」與上一個、下一個出處，以及「在圖譜中查看」的目標實體。
// 純函式；輸入是這一題回答引用到的段落與送出當下身分的圖譜（RLS 已篩選），不另外判斷權限。
import type { GraphEntity } from "../graph/read";

export interface SourceSteps {
  // 目前段落是這一題的第幾個出處（從 1 開始）與出處數
  index: number;
  total: number;
  // 上一個、下一個出處的段落 id；第一個沒有上一個、最後一個沒有下一個（不循環）
  prev: string | null;
  next: string | null;
}

// cited：回答引用到的段落（answer.cited，依第一次引用的順序），不是送進 prompt 的全部段落（numbering，#256 補充決定）；
// 同一段出現多次只算一次。段落不是這一題引用到的時（例如從段落旁的標示打開的另一段）回 null，不顯示 N／M 與上下按鈕
export function sourceSteps(cited: readonly string[], passage: string): SourceSteps | null {
  const passages = [...new Set(cited)];
  const at = passages.indexOf(passage);
  if (at < 0) return null;
  return { index: at + 1, total: passages.length, prev: passages[at - 1] ?? null, next: passages[at + 1] ?? null };
}

// 「在圖譜中查看」的目標（#256 決定 2）：這一題「回答提到」的實體中，出處包含目前引用段落的優先（依回答提到的順序）；
// 其次是文件中最先提到的（依段落順序，第一個出處在該段的實體）；都沒有時 null，不顯示按鈕
export function sourceGraphTarget(entities: readonly GraphEntity[], highlight: string, documentPassages: readonly string[]): string | null {
  const cites = (e: GraphEntity, passage: string) => e.sources.some((p) => p.id === passage);
  const direct = entities.find((e) => cites(e, highlight));
  if (direct !== undefined) return direct.id;
  for (const passage of documentPassages) {
    const found = entities.find((e) => cites(e, passage));
    if (found !== undefined) return found.id;
  }
  return null;
}
