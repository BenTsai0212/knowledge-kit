// 問答的錯誤依「使用者可以做什麼」分成五類（#280，docs/design.md「錯誤與額度」），每一類有固定的位置：
// 暫時的問題與模型無法回答在回答的位置；問題要改在輸入框（prompt_too_long 在回答的位置）；今天用完了在輸入框上方；需要管理者在對話區頂端。
import type { AskErrorType } from "../client/types";
import { MAX_QUESTION_CHARS } from "../qa/prompt";

export type ErrorCategory = "transient" | "fixQuestion" | "dailyLimit" | "admin" | "modelRefusal";

// invalid_access_code 不在五類中：清除邀請碼並回到入口頁（#26 決定 3）。少了任何一種錯誤類型，型別檢查就會失敗
const CATEGORY: Record<Exclude<AskErrorType, "invalid_access_code">, ErrorCategory> = {
  upstream_overloaded: "transient",
  upstream_timeout: "transient",
  upstream_error: "transient",
  limit_unavailable: "transient",
  network: "transient",
  unexpected_response: "transient",
  upstream_interrupted: "transient",
  empty_question: "fixQuestion",
  question_too_long: "fixQuestion",
  prompt_too_long: "fixQuestion",
  daily_limit: "dailyLimit",
  global_daily_limit: "dailyLimit",
  unknown_model: "admin",
  misconfigured: "admin",
  upstream_quota: "admin",
  forbidden_origin: "admin",
  invalid_request: "admin",
  method_not_allowed: "admin",
  upstream_refusal: "modelRefusal",
};

// 不認得的錯誤類型當作暫時的問題（可以再試）
export function errorCategory(error: string): ErrorCategory {
  return Object.hasOwn(CATEGORY, error) ? CATEGORY[error as keyof typeof CATEGORY] : "transient";
}

// 需要管理者的錯誤中，下一步是重新整理頁面的類型
export const needsReload = (error: string) => error === "invalid_request" || error === "method_not_allowed";

// 輸入框的字數：接近上限（90%）時顯示，超過上限時停用提問
export const COUNTER_FROM = Math.floor(MAX_QUESTION_CHARS * 0.9);

export function questionLength(text: string): { show: boolean; over: boolean } {
  const length = text.trim().length;
  return { show: length >= COUNTER_FROM, over: length > MAX_QUESTION_CHARS };
}

// 這一題的錯誤：完全失敗時是 error；中斷但已收到文字時是 incomplete 的 answer 附上的 error
export function turnError(answer: { kind: string; error?: string } | undefined): string | undefined {
  return answer?.kind === "error" || answer?.kind === "answer" ? answer.error : undefined;
}
