// 呼叫 Claude Messages API（https://platform.claude.com/docs/en/build-with-claude/streaming），
// 把上游的 SSE 轉成給前端的精簡 SSE：delta（文字）、done（stop_reason）、error（錯誤類型）。不轉送 thinking。
import type { UpstreamErrorType } from "./errors";
import { MODELS } from "./models";
import type { AskRequest } from "./request";
import { formatSse, parseSse } from "./sse";

export const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function upstreamHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
}

// 模型名稱、max_tokens、effort 一律來自白名單
export function buildUpstreamBody(ask: AskRequest) {
  const spec = MODELS[ask.model];
  return {
    model: spec.model,
    max_tokens: spec.maxTokens,
    output_config: { effort: spec.effort },
    stream: true,
    ...(ask.system !== undefined && { system: ask.system }),
    messages: ask.messages,
  };
}

export interface UpstreamFailure {
  type: UpstreamErrorType;
  status: number;
  upstreamStatus?: number;
  requestId?: string;
}

// https://platform.claude.com/docs/en/api/errors
export async function classifyHttpError(res: Response): Promise<UpstreamFailure> {
  let error: { type?: string; message?: string } | undefined;
  let requestId = res.headers.get("request-id") ?? undefined;
  try {
    const body = await res.json<{ error?: { type?: string; message?: string }; request_id?: string }>();
    error = body.error;
    requestId ??= body.request_id;
  } catch {
    // 本文不是 JSON 時只依狀態碼判斷
  }
  const base = { upstreamStatus: res.status, ...(requestId && { requestId }) };
  // 組織或 workspace 的花費上限回 400，只能從訊息辨識
  const spendLimit = res.status === 400 && /spend limit/i.test(error?.message ?? "");
  if (res.status === 402 || res.status === 429 || spendLimit) return { type: "upstream_quota", status: 502, ...base };
  if (res.status === 529 || error?.type === "overloaded_error") return { type: "upstream_overloaded", status: 503, ...base };
  if (res.status === 504) return { type: "upstream_timeout", status: 504, ...base };
  return { type: "upstream_error", status: 502, ...base };
}

export interface StreamOutcome {
  stopReason?: string;
  error?: UpstreamErrorType;
}

// 上游串流 → 前端串流；結束（含中斷）時以 onEnd 回報結果
export function relayStream(upstream: ReadableStream<Uint8Array>, onEnd: (outcome: StreamOutcome) => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const events = parseSse(upstream);
  let stopReason: string | undefined;
  let finished = false;
  const finish = (controller: ReadableStreamDefaultController<Uint8Array>, outcome: StreamOutcome) => {
    finished = true;
    controller.enqueue(encoder.encode(outcome.error ? formatSse("error", { type: outcome.error }) : formatSse("done", { stopReason: outcome.stopReason })));
    controller.close();
    onEnd(outcome);
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const next = await events.next();
          if (next.done) return finish(controller, { error: "upstream_interrupted" });
          const { event, data } = next.value;
          if (event === "error") {
            const type = (JSON.parse(data) as { error?: { type?: string } }).error?.type;
            return finish(controller, { error: type === "overloaded_error" ? "upstream_overloaded" : "upstream_interrupted" });
          }
          if (event === "message_stop") {
            return finish(controller, stopReason === "refusal" ? { stopReason, error: "upstream_refusal" } : { stopReason });
          }
          if (event === "message_delta") {
            stopReason = (JSON.parse(data) as { delta?: { stop_reason?: string } }).delta?.stop_reason ?? stopReason;
          } else if (event === "content_block_delta") {
            const delta = (JSON.parse(data) as { delta?: { type?: string; text?: string } }).delta;
            if (delta?.type === "text_delta" && delta.text) {
              controller.enqueue(encoder.encode(formatSse("delta", { text: delta.text })));
              return;
            }
          }
        }
      } catch {
        if (!finished) finish(controller, { error: "upstream_interrupted" });
      }
    },
    async cancel() {
      // 前端中斷時一併停止讀取上游
      await events.return(undefined);
      if (!finished) {
        finished = true;
        onEnd({ error: "upstream_interrupted" });
      }
    },
  });
}
