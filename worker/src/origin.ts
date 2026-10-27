// 只接受同站請求，或 ALLOWED_ORIGINS 列出的 Origin（例如本機的 Vite 開發伺服器）。
export function isAllowedOrigin(request: Request, allowed: readonly string[]): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  if (allowed.includes(origin)) return true;
  if (origin !== new URL(request.url).origin) return false;
  const site = request.headers.get("Sec-Fetch-Site");
  return site === null || site === "same-origin";
}
