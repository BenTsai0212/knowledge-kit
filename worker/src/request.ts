// 驗證 /api/ask 的 body，只取出白名單內的欄位；max_tokens、實際模型名稱等其他欄位一律丟棄。
import { isModelCode, type ModelCode } from "./models";

export interface AskMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskRequest {
  model: ModelCode;
  system?: string;
  messages: AskMessage[];
}

export type ParseResult =
  | { ok: true; ask: AskRequest; promptChars: number }
  | { ok: false; error: "invalid_request" | "unknown_model" | "prompt_too_long" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseMessage(v: unknown): AskMessage | null {
  if (!isObject(v) || (v.role !== "user" && v.role !== "assistant") || typeof v.content !== "string") return null;
  return { role: v.role, content: v.content };
}

export function parseAskBody(body: unknown, maxPromptChars: number): ParseResult {
  if (!isObject(body) || typeof body.model !== "string" || !Array.isArray(body.messages)) return { ok: false, error: "invalid_request" };
  if (body.system !== undefined && typeof body.system !== "string") return { ok: false, error: "invalid_request" };
  const messages = body.messages.map(parseMessage);
  // 對話必須以 user 開始與結束（目前的模型不接受 assistant prefill）
  if (messages.length === 0 || messages.some((m) => m === null) || messages[0]?.role !== "user" || messages.at(-1)?.role !== "user") {
    return { ok: false, error: "invalid_request" };
  }
  if (!isModelCode(body.model)) return { ok: false, error: "unknown_model" };
  const valid = messages as AskMessage[];
  const promptChars = (body.system?.length ?? 0) + valid.reduce((n, m) => n + m.content.length, 0);
  if (promptChars > maxPromptChars) return { ok: false, error: "prompt_too_long" };
  return {
    ok: true,
    ask: { model: body.model, ...(body.system !== undefined && { system: body.system }), messages: valid },
    promptChars,
  };
}
