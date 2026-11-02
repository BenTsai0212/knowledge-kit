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

export type View = "qa" | "graph" | "timeline" | "upload" | "review" | "evals";

// 頁籤：待審與評測台只給 canReview 的身分；線上 demo 隱藏評測台（一次會呼叫大量問答，#100 決定 4）
export function visibleViews(canReview: boolean, demo: Pick<OnlineDemo, "enabled">): View[] {
  const views: View[] = ["qa", "graph", "timeline", "upload"];
  if (canReview) views.push("review");
  if (canReview && !demo.enabled) views.push("evals");
  return views;
}
