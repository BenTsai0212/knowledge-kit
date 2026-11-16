// 問答的說法不同提問（ADR 0012 決定 3、4，docs/qa.md「說法不同的提問」）：選項與選了之後 AI 說什麼。純函式；
// 輸入是送出身分讀得到的一組並存（readCoexistingPair()），所以只用目前身分看得到的兩段（#247）。
import type { ConflictItem, ConflictPassage } from "./store";

// 固定範本的三個選項（假設或證據留空時，ADR 0012 決定 3）：後來改過、不同的情況、有一份寫錯了
export const TEMPLATE_CHOICES = ["changed", "different", "wrong"] as const;
export type TemplateChoice = (typeof TEMPLATE_CHOICES)[number];

// 選了之後：
// - evidence：選的就是證據支持的假設，補一句證據
// - challenge：與證據不合，以「另一種讀法」提出證據支持的假設（to 是選項的位置）一次
// - challengeDate：固定範本，兩份相差一個月以上而選「有一份寫錯了」，提出「後來改過」
// - record：只說明會記錄
export type SeamReply =
  | { kind: "evidence"; passage: ConflictPassage; quote: string }
  | { kind: "challenge"; to: number; passage: ConflictPassage; quote: string }
  | { kind: "challengeDate"; to: number; months: number }
  | { kind: "record" };

// 假設與證據都有時用存下來的假設，否則用固定範本
export const usesTemplate = (item: ConflictItem): boolean => item.hypotheses === null || item.evidence === null;

// 依文件日期分新舊；日期相同或缺少時，新上傳的文件（newPassage）當作較新
export function byDate(item: ConflictItem): { newer: ConflictPassage; older: ConflictPassage } {
  const { newPassage: a, oldPassage: b } = item;
  return b.date !== null && (a.date === null || b.date > a.date) ? { newer: b, older: a } : { newer: a, older: b };
}

// 兩個日期（YYYY-MM-DD）相差的整月數；缺少日期或不晚於時為 0
export function monthsBetween(older: string | null, newer: string | null): number {
  if (older === null || newer === null) return 0;
  const [y1, m1, d1] = older.split("-").map(Number);
  const [y2, m2, d2] = newer.split("-").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

// 選了 chosen（選項的位置，0 起算）之後的回應。證據只在選完、而且不合時才提出（避免錨定，ADR 0012 決定 4）
export function seamReply(item: ConflictItem, chosen: number): SeamReply {
  if (usesTemplate(item)) {
    const { newer, older } = byDate(item);
    const months = monthsBetween(older.date, newer.date);
    const wrong = TEMPLATE_CHOICES.indexOf("wrong");
    return months >= 1 && chosen === wrong ? { kind: "challengeDate", to: TEMPLATE_CHOICES.indexOf("changed"), months } : { kind: "record" };
  }
  const evidence = item.evidence!;
  // 證據逐字出現在其中一段（output.ts 已驗證）；找不到時只說明會記錄
  const passage = [item.newPassage, item.oldPassage].find((p) => p.content.includes(evidence.text));
  if (passage === undefined) return { kind: "record" };
  const supported = evidence.supports - 1;
  return chosen === supported
    ? { kind: "evidence", passage, quote: evidence.text }
    : { kind: "challenge", to: supported, passage, quote: evidence.text };
}
