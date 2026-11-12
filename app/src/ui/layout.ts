// 手機與平板的版面（#255，docs/design.md「手機與平板」）：斷點、手機底部分頁列的分配與底部面板往下拖曳的門檻。
// App 依 layoutFor() 只渲染一種導覽結構（手機頂端列＋分頁列、桌機左側導覽），不同時渲染再用 CSS 隱藏，避免重複的地標與焦點順序。
import { useSyncExternalStore } from "react";
import { EMPTY_ICONS } from "./empty-state";
import type { View } from "./online-demo";

export type Layout = "phone" | "tablet" | "desktop";

// ≤ 600px 手機、601–1024px 平板、≥ 1025px 桌機
export const PHONE_MAX = 600;
export const TABLET_MAX = 1024;

export const layoutFor = (width: number): Layout => (width <= PHONE_MAX ? "phone" : width <= TABLET_MAX ? "tablet" : "desktop");

// 手機底部分頁列（docs/design.md「日常工具 › 手機」）：5 個以內全放；超過時依這個順序保留前 4 個，其餘依原本的順序收進「更多」。
// 一般員工是首頁、問答、圖譜、時間軸、上傳；主管是首頁、問答、圖譜、上傳、更多（時間軸、待審、評測台）
const PHONE_PRIORITY: readonly View[] = ["home", "qa", "graph", "upload", "timeline", "review", "evals"];
export const PHONE_TAB_LIMIT = 5;

export interface PhoneTabs {
  tabs: View[];
  more: View[];
}

export function phoneTabs(views: readonly View[]): PhoneTabs {
  if (views.length <= PHONE_TAB_LIMIT) return { tabs: [...views], more: [] };
  const kept = PHONE_PRIORITY.filter((v) => views.includes(v)).slice(0, PHONE_TAB_LIMIT - 1);
  return { tabs: kept, more: views.filter((v) => !kept.includes(v)) };
}

// 只有兩個頁籤時（展示模式）改用頂端的分段切換，不顯示底部分頁列。展示模式登入後由 PresentationBar 取代 MobileNav（#260），
// 所以 MobileNav 的分段切換只出現在展示模式的登入頁
export const usesSegmented = (views: readonly View[]): boolean => views.length <= 2;

// 底部面板往下拖曳超過面板高度的 1/4（最多 96px）就關閉，否則彈回原位
export const SHEET_DRAG_CLOSE_PX = 96;
export const sheetDragCloses = (dy: number, sheetHeight: number): boolean => dy > 0 && dy >= Math.min(SHEET_DRAG_CLOSE_PX, sheetHeight / 4);

// 可展開的底部面板（#257 的實體面板）：停在 56% 高（half），往上拉到全高（full）。放開時依拖曳的距離決定停在哪一段，
// 門檻與 sheetDragCloses() 相同：half 往上拉過門檻到 full、往下拉過門檻關閉；full 往下拉過門檻回到 half；沒過門檻時彈回原段
export type SheetStop = "half" | "full";
export const SHEET_HALF = 0.56;

export function sheetSnap(at: SheetStop, dy: number, sheetHeight: number): SheetStop | "close" {
  if (at === "half") return sheetDragCloses(-dy, sheetHeight) ? "full" : sheetDragCloses(dy, sheetHeight) ? "close" : "half";
  return sheetDragCloses(dy, sheetHeight) ? "half" : "full";
}

// 實體面板停在 56% 高時圖譜還看得到的部分（#257）：畫布從上緣到面板上緣（視窗高的 44%）；面板沒蓋到畫布或 cover 是 0 時是整個畫布。
// canvas 是畫布在視窗中的上緣與大小（getBoundingClientRect），回傳的大小以畫布的 rendered px 計
export function visibleArea(canvas: { top: number; width: number; height: number }, viewportHeight: number, cover: number): { width: number; height: number } {
  const above = viewportHeight * (1 - cover) - canvas.top;
  return { width: canvas.width, height: cover > 0 && above > 0 ? Math.min(canvas.height, above) : canvas.height };
}

// 分頁列的圖示（24×24 的線條，沿用空狀態的圖示）；首頁與「更多」另外畫
export const NAV_ICONS: Record<View | "more", string> = {
  // 首頁：房子
  home: "M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-5h4v5",
  qa: EMPTY_ICONS.question,
  graph: EMPTY_ICONS.graph,
  timeline: EMPTY_ICONS.timeline,
  upload: EMPTY_ICONS.upload,
  review: EMPTY_ICONS.review,
  evals: EMPTY_ICONS.evals,
  // 更多：三個點
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
};

// 目前的版面，視窗寬度跨過斷點時更新；沒有 matchMedia 的環境（測試）當作桌機
const QUERIES = [`(max-width: ${PHONE_MAX}px)`, `(max-width: ${TABLET_MAX}px)`];

function subscribe(onChange: () => void): () => void {
  const lists = QUERIES.map((q) => globalThis.matchMedia?.(q)).filter((l) => l !== undefined);
  lists.forEach((l) => l.addEventListener("change", onChange));
  return () => lists.forEach((l) => l.removeEventListener("change", onChange));
}

const current = (): Layout => (globalThis.matchMedia === undefined ? "desktop" : layoutFor(globalThis.innerWidth));

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, current, () => "desktop");
}
