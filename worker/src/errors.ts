// /api/ask 回給前端的錯誤類型；前端依 error 欄位（串流中為 error 事件的 type）顯示訊息。
export type ErrorType =
  | "forbidden_origin"
  | "invalid_access_code"
  | "daily_limit"
  | "global_daily_limit"
  | "invalid_request"
  | "unknown_model"
  | "prompt_too_long"
  | "limit_unavailable"
  | "misconfigured"
  | "method_not_allowed"
  | UpstreamErrorType;

// 上游（Claude Messages API）的錯誤；後兩種只出現在串流中
export type UpstreamErrorType =
  | "upstream_quota"
  | "upstream_overloaded"
  | "upstream_timeout"
  | "upstream_error"
  | "upstream_refusal"
  | "upstream_interrupted";

export function errorResponse(type: ErrorType, status: number): Response {
  return Response.json({ error: type }, { status });
}
