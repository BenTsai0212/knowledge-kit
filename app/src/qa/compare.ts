// 身分對照（#261，docs/qa.md「身分對照」）：同一題以每個身分各送出一次。
// 每一欄都呼叫一般提問的 ask()，identityId 換成該欄的身分：檢索（retrieve(identityId, …)，權限由 RLS 決定）、組 prompt、/api/ask 都和一般提問相同，
// 欄之間不共用檢索結果或回答。依身分順序一欄一欄送出（#261 決定 3），所以中途用完每日次數時，之後的欄不再送出。
import { ask, type Answer, type QaContext, type Question } from "./answer";

// 今天用完了（docs/design.md「錯誤與額度」）：收到後之後的欄不再送出
export const QUOTA_ERRORS: ReadonlySet<string> = new Set(["daily_limit", "global_daily_limit"]);

export interface CompareCallbacks {
  // 第 index 欄到目前為止可顯示的全部文字（同 ask() 的 onText）
  onText?: (index: number, text: string) => void;
  // 第 index 欄的結果（沒有送出的欄也會收到額度錯誤）
  onAnswer?: (index: number, answer: Answer) => void;
}

// identities 是欄的順序（client/access.json 的身分順序）。回傳每一欄的結果；signal 中止後（切換題目、關閉對照、切換語言）不再送出、
// 不再呼叫 callbacks，回傳到目前為止完成的欄（呼叫端應忽略中止後的結果）
export async function askEach(
  ctx: QaContext,
  identities: readonly string[],
  q: Omit<Question, "identityId">,
  callbacks: CompareCallbacks = {},
  signal?: AbortSignal,
): Promise<Answer[]> {
  const answers: Answer[] = [];
  let quota: string | null = null;
  for (const [index, identityId] of identities.entries()) {
    if (signal?.aborted) break;
    const answer: Answer =
      quota !== null
        ? { kind: "error", error: quota }
        : await ask(ctx, { ...q, identityId }, (text) => {
            if (!signal?.aborted) callbacks.onText?.(index, text);
          }, signal);
    if (signal?.aborted) break;
    if (answer.kind === "error" && QUOTA_ERRORS.has(answer.error)) quota = answer.error;
    answers.push(answer);
    callbacks.onAnswer?.(index, answer);
  }
  return answers;
}

// 開啟對照前：這個分頁已收到「今天用完了」時只顯示說明、不送出（#261 決定 2）。前端不知道剩餘次數，其他情況照常送出
export const canStartCompare = (dailyLimitError: string | null): boolean => dailyLimitError === null || !QUOTA_ERRORS.has(dailyLimitError);
