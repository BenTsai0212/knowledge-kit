// 空狀態（#245，docs/design.md「狀態的共同語言」）：虛線框＋一個線條圖示＋粗體標題＋一句原因＋最多兩個下一步，
// 第一個下一步是主要按鈕。不用插圖、不用驚嘆號。原因只說明目前身分看得到的範圍，不暗示有看不到的內容（#247）

export interface EmptyAction {
  label: string;
  onClick(): void;
  disabled?: boolean;
}

// 最多兩個下一步：多的捨去
export const MAX_EMPTY_ACTIONS = 2;
export const emptyActions = (actions: readonly EmptyAction[]): EmptyAction[] => actions.slice(0, MAX_EMPTY_ACTIONS);

// 線條圖示（24×24，stroke 用 currentColor，不填色）
export const EMPTY_ICONS = {
  // 問答：對話框
  question: "M4 5h16v11H9l-5 4z M8 9h8 M8 12h5",
  // 圖譜：三個節點與兩條連線
  graph: "M7 7m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M17 7m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M12 17m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M9.5 7h5 M8.3 9.2l2.4 5.6",
  // 路徑：起點、終點與中間斷開的線
  path: "M5 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M19 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M7 18h4 M13 6h4 M11 18l1-3 M13 9l-1 3",
  // 時間軸：月曆
  timeline: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
  // 上傳：向上的箭頭與底線
  upload: "M12 16V5 M7 10l5-5 5 5 M5 19h14",
  // 待審：收件匣
  review: "M4 13l2.5-8h11l2.5 8v6H4z M4 13h5l1 2h4l1-2h5",
  // 回報：旗子
  report: "M6 21V4 M6 4h11l-2 4 2 4H6",
  // 評測：長條圖
  evals: "M5 20V10 M12 20V4 M19 20v-7 M3 20h18",
} as const;

export type EmptyIconName = keyof typeof EMPTY_ICONS;

// 「切換身分」：把焦點移到頁首的身分選單（線上 demo 的身分切換本來就公開，#245 決定）
export const IDENTITY_SELECT_ID = "identity-select";
export const focusIdentity = () => document.getElementById(IDENTITY_SELECT_ID)?.focus();

// 問答尚未提問時的「從預設問題開始」：把焦點移到第一個預設問題（輸入區的預設問題列）
export const PRESETS_ID = "preset-questions";
export const focusPresets = () => document.querySelector<HTMLButtonElement>(`#${PRESETS_ID} button:not(:disabled)`)?.focus();
