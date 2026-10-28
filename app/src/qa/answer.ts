// 問答流程：retrieve() → 沒有段落時本機拒答 → 組 prompt → /api/ask → 判斷拒答標記 → 解析引用。
// 段落只透過 Retriever 取得（權限由 RLS 決定）；本模組不直接查詢資料庫（structure.test.ts 檢查）。
import type { LanguageCode, LocalizedText, ModelCode } from "../client/types";
import type { Retriever } from "../retrieval/retrieve";
import { strings } from "../ui/strings";
import { resolveCitations } from "./citations";
import { buildPrompt, MAX_QUESTION_CHARS, REFUSAL_MARKER } from "./prompt";
import type { AskEvent, AskTransport } from "./types";

export type Answer =
  // 拒答文字固定，不區分本機或模型拒答，也不區分沒有資料或沒有權限
  | { kind: "refusal"; text: string }
  | {
      kind: "answer";
      text: string;
      // 第 i 個元素是引用編號 i + 1 的段落 id
      numbering: string[];
      cited: string[];
      dropped: number[];
      // 沒有任何有效引用：畫面標示「未附出處」
      uncited: boolean;
      // 串流中斷或被截斷：保留已收到的內容
      incomplete: boolean;
      error?: string;
    }
  // 還沒收到任何內容就失敗；error 是 /api/ask 的錯誤類型，或 empty_question、question_too_long
  | { kind: "error"; error: string };

export interface QaContext {
  retriever: Retriever;
  transport: AskTransport;
  model: ModelCode;
  displayName: LocalizedText;
}

export interface Question {
  identityId: string | null;
  text: string;
  // 介面語言：決定回答語言與拒答文字（#26 決定 2）
  language: LanguageCode;
}

// 還不能確定開頭不是拒答標記時先不顯示，避免畫面先閃出標記
const mayBeMarker = (text: string) => REFUSAL_MARKER.startsWith(text.trimStart());

// onText 收到的是到目前為止可顯示的全部文字（不是片段）
export async function ask(ctx: QaContext, q: Question, onText?: (text: string) => void): Promise<Answer> {
  const question = q.text.trim();
  if (question === "") return { kind: "error", error: "empty_question" };
  if (question.length > MAX_QUESTION_CHARS) return { kind: "error", error: "question_too_long" };

  const refusal: Answer = { kind: "refusal", text: strings(q.language).refusal };
  const passages = await ctx.retriever.retrieve(q.identityId, question);
  const prompt =
    passages.length > 0 ? buildPrompt(passages, question, { companyName: ctx.displayName[q.language], language: q.language }) : null;
  if (prompt === null) return refusal;

  let text = "";
  let end: AskEvent | undefined;
  const events = ctx.transport.send({ model: ctx.model, system: prompt.system, messages: [{ role: "user", content: prompt.user }] });
  for await (const event of events) {
    if (event.type !== "delta") {
      end = event;
      break;
    }
    text += event.text;
    if (!text.includes(REFUSAL_MARKER) && !mayBeMarker(text)) onText?.(text);
  }

  // 標記出現在任何位置都算拒答
  if (text.includes(REFUSAL_MARKER)) return refusal;
  const visible = mayBeMarker(text) ? "" : text;
  // 串流沒有 done 或 error 就結束，視為中斷
  const error = end === undefined ? "upstream_interrupted" : end.type === "error" ? end.error : undefined;
  if (visible.trim() === "") return error === undefined ? refusal : { kind: "error", error };

  const { text: resolved, cited, dropped } = resolveCitations(visible, prompt.numbering);
  if (dropped.length > 0) console.warn(`回答引用了不存在的段落編號：${dropped.join(", ")}`);
  return {
    kind: "answer",
    text: resolved,
    numbering: prompt.numbering,
    cited,
    dropped,
    uncited: cited.length === 0,
    incomplete: error !== undefined || (end?.type === "done" && end.stopReason === "max_tokens"),
    ...(error !== undefined && { error }),
  };
}
