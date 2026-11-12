// 線上 demo 的 build 時設定（#100，docs/qa.md「線上 demo」）。營運開關，預設關閉：只有 VITE_ONLINE_DEMO 是 "1" 時開啟。
// 屬於部署設定，不放進 client/：客戶的 fork 不繼承 demo 的限制。build 時由 Vite 代入，執行時不能更改。
export interface OnlineDemo {
  enabled: boolean;
  // 預先填入邀請碼表單的公開試用碼（Worker 的 ACCESS_CODES 中 public 組的碼）；刻意公開，不是 secret。開關關閉時一律為空字串
  publicAccessCode: string;
}

export function readOnlineDemo(env: Record<string, unknown>): OnlineDemo {
  const enabled = env.VITE_ONLINE_DEMO === "1";
  const code = env.VITE_PUBLIC_ACCESS_CODE;
  return { enabled, publicAccessCode: enabled && typeof code === "string" ? code.trim() : "" };
}

export const onlineDemo: OnlineDemo = readOnlineDemo(import.meta.env);

export type View = "home" | "qa" | "graph" | "timeline" | "upload" | "review" | "evals";

// 客戶展示模式（#129，docs/qa.md「展示模式」）：網址的 mode 參數是 "presentation"（區分大小寫）時開啟，其他值或沒有參數時關閉。
// 只在載入時讀一次，不存進任何瀏覽器儲存。只是隱藏頁籤，不是權限防線：權限仍由 RLS 執行。
export function readPresentationMode(search: string): boolean {
  return new URLSearchParams(search).get("mode") === "presentation";
}

// 測試環境（Node）沒有 location，所以是關閉的
export const presentationMode: boolean = readPresentationMode(globalThis.location?.search ?? "");

// 展示模式時 <html> 的標記（#260）：app.css 的 :root[data-mode="presentation"] 以 --present-* 放大字級，顏色不變
export const MODE_ATTRIBUTE = "data-mode";
export function markPresentation(root: Pick<Element, "setAttribute">, presentation: boolean): void {
  if (presentation) root.setAttribute(MODE_ATTRIBUTE, "presentation");
}

// 評測台（#192，docs/evals.md「開啟評測台」）：網址的 tools 參數是 "evals"（區分大小寫）時開啟，其他值或沒有參數時關閉。
// 評測台是交付方的工具，客戶一般使用時不顯示。寫法與展示模式相同：只在載入時讀一次、不存進瀏覽器儲存、不是權限防線
export function readEvalsMode(search: string): boolean {
  return new URLSearchParams(search).get("tools") === "evals";
}

export const evalsMode: boolean = readEvalsMode(globalThis.location?.search ?? "");

// 頁籤：待審只給 canReview 的身分；評測台另外要以 tools=evals 開啟（#192）。線上 demo 隱藏評測台（一次會呼叫大量問答，#100 決定 4）；
// 展示模式只留問答與圖譜，所有身分相同（#129）。兩者同時開啟時取交集。首頁在最前面（#283）；展示模式沒有首頁
export function visibleViews(canReview: boolean, demo: Pick<OnlineDemo, "enabled">, presentation: boolean, evals: boolean): View[] {
  const views: View[] = ["home", "qa", "graph", "timeline", "upload"];
  if (canReview) views.push("review");
  if (canReview && evals && !demo.enabled) views.push("evals");
  return presentation ? views.filter((v) => v === "qa" || v === "graph") : views;
}

// 登入後的預設頁（#283，docs/design.md「日常工具」）：首頁；展示模式不顯示首頁，直接進問答
export const defaultView = (presentation: boolean): View => (presentation ? "qa" : "home");
