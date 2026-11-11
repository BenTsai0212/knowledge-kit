// 動態的刻度（docs/design.md「動態」）：時間都經過 motionDuration()，系統設定「減少動態效果」時為 0（直接套用最後的狀態）。
// CSS 的動畫讀 motionStyleSheet() 產生的變數（--motion-*、--ease-*），減少動態效果時變數為 0ms、動畫關閉；
// cytoscape 的動畫由 JS 執行，以 watchReducedMotion() 判斷。

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// 新展開的節點放大浮現、由灰轉成類型色；新的線由起點畫向終點（圖譜，#199）
export const EXPAND_MS = 300;
// 畫面平滑移動，讓選取的節點靠近中央（圖譜，#199）
export const PAN_MS = 400;

export const MOTION = {
  // 按下、hover、標號變實心、所有退場
  fast: 120,
  // 面板、列、句子
  base: 220,
  // 列的展開與收合、圖譜節點展開
  expand: EXPAND_MS,
  // 原文螢光刷亮、圖譜平移
  sweep: PAN_MS,
  // 只給「新的知識」：引用標號等
  settle: 520,
} as const;

// 依序出現的間隔：清單 60ms、回答的句子 80ms
export const STAGGER = { list: 60, sentence: 80 } as const;
// 超過 6 項後不再延遲：第 7 項起與第 6 項同時出現
export const STAGGER_LIMIT = 6;

export const EASING = {
  enter: "cubic-bezier(.2,0,0,1)",
  exit: "cubic-bezier(.4,0,1,1)",
  // settle 專用
  spring: "cubic-bezier(.3,1.5,.5,1)",
  // progress 專用：依實際進度填滿（評測題數等）
  linear: "linear",
} as const;

export const motionDuration = (reduced: boolean, ms: number): number => (reduced ? 0 : ms);

// 第 index 項（從 0 起）的延遲
export const staggerIndex = (index: number): number => Math.min(Math.max(index, 0), STAGGER_LIMIT - 1);
export const staggerDelay = (reduced: boolean, index: number, step: number): number => motionDuration(reduced, staggerIndex(index) * step);

// CSS 變數：--motion-fast、--motion-stagger-list 等（時間）與 --ease-enter 等（曲線）
export function motionVariables(reduced: boolean): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(MOTION).map(([name, ms]) => [`--motion-${name}`, `${motionDuration(reduced, ms)}ms`])),
    ...Object.fromEntries(Object.entries(STAGGER).map(([name, ms]) => [`--motion-stagger-${name}`, `${motionDuration(reduced, ms)}ms`])),
    ...Object.fromEntries(Object.entries(EASING).map(([name, curve]) => [`--ease-${name}`, curve])),
  };
}

const declarations = (variables: Record<string, string>) =>
  Object.entries(variables)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");

// main.tsx 放進 <style> 的內容（與 themeStyleSheet() 相同的做法）
export function motionStyleSheet(): string {
  return [`:root { ${declarations(motionVariables(false))} }`, `@media ${REDUCED_MOTION} { :root { ${declarations(motionVariables(true))} } }`].join("\n");
}

// 目前是否減少動態效果，並在系統設定改變時呼叫 onChange；回傳取消監聽的函式（仿照 theme.ts 的 watchColorScheme）
export function watchReducedMotion(matchMedia: (query: string) => MediaQueryList, onChange: (reduced: boolean) => void): () => void {
  const query = matchMedia(REDUCED_MOTION);
  const listener = () => onChange(query.matches);
  query.addEventListener("change", listener);
  onChange(query.matches);
  return () => query.removeEventListener("change", listener);
}
