// /api/ask 回給前端的錯誤類型；前端依 error 欄位顯示訊息。
export type ErrorType =
  | "forbidden_origin"
  | "invalid_access_code"
  | "daily_limit"
  | "invalid_request"
  | "unknown_model"
  | "prompt_too_long"
  | "limit_unavailable"
  | "misconfigured"
  | "method_not_allowed"
  | "not_implemented";

export function errorResponse(type: ErrorType, status: number): Response {
  return Response.json({ error: type }, { status });
}
