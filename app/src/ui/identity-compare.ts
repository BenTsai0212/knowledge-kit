// 身分對照的畫面（#261，docs/design.md「展示模式」的「身分對照」、docs/qa.md「身分對照」）：純函式，畫面在 IdentityCompare.tsx，
// 送出在 qa/compare.ts 的 askEach()。欄的順序是 client/access.json 的身分順序，目前身分的欄用 primary 框線。
import type { AccessFile, LanguageCode } from "../client/types";

export interface CompareColumn {
  role: string;
  label: string;
  current: boolean;
}

export function compareColumns(access: Pick<AccessFile, "roles">, identity: string, language: LanguageCode): CompareColumn[] {
  return access.roles.map((r) => ({ role: r.id, label: r.label[language], current: r.id === identity }));
}

// 開啟對照時的「目前的題目」：目前身分的對話中最後一題；還沒有題目時是 null（等劇本或輸入區送出）
export const compareQuestion = (turns: readonly { question: string }[]): string | null => turns.at(-1)?.question ?? null;

// 依身分順序一欄一欄送出（#261 決定 3）：第 index 欄在前面的欄都有結果後才送出。finished 是已有結果的欄數
export const columnStarted = (index: number, finished: number): boolean => index <= finished;

// 主持人快捷鍵（docs/design.md「主持人快捷鍵」）：C 開關對照、Esc 關閉。焦點在文字輸入（輸入框、選單）或有 Ctrl／Meta／Alt 時不處理
export type CompareKey = "toggle" | "close";

interface KeyTarget {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

// 不是文字輸入的 input（身分的 radio、按鈕等）：按 C 仍是快捷鍵
const NON_TEXT_INPUTS = new Set(["radio", "checkbox", "button", "submit", "reset", "range", "color", "file"]);

export function isTextEntry(target: KeyTarget | null): boolean {
  if (target === null) return false;
  if (target.isContentEditable === true) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && !NON_TEXT_INPUTS.has((target.type ?? "text").toLowerCase());
}

export function compareKey(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: KeyTarget | null },
  open: boolean,
): CompareKey | null {
  if (event.ctrlKey || event.metaKey || event.altKey || isTextEntry(event.target)) return null;
  if (event.key === "c" || event.key === "C") return "toggle";
  if (event.key === "Escape" && open) return "close";
  return null;
}
