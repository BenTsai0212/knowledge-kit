// 圖譜的動態（#199）：時間都經過 motionDuration()，系統設定「減少動態效果」時為 0（直接套用最後的狀態）。
// CSS 的動畫以 @media (prefers-reduced-motion: reduce) 關閉；cytoscape 的動畫由 JS 執行，以這裡判斷。

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// 新展開的節點放大浮現、由灰轉成類型色；新的線由起點畫向終點
export const EXPAND_MS = 300;
// 畫面平滑移動，讓選取的節點靠近中央
export const PAN_MS = 400;

export const motionDuration = (reduced: boolean, ms: number): number => (reduced ? 0 : ms);

// 目前是否減少動態效果，並在系統設定改變時呼叫 onChange；回傳取消監聽的函式（仿照 theme.ts 的 watchColorScheme）
export function watchReducedMotion(matchMedia: (query: string) => MediaQueryList, onChange: (reduced: boolean) => void): () => void {
  const query = matchMedia(REDUCED_MOTION);
  const listener = () => onChange(query.matches);
  query.addEventListener("change", listener);
  onChange(query.matches);
  return () => query.removeEventListener("change", listener);
}
