// worker 測試共用的假實作：邀請碼、假的上游與 log。上游一律不實際呼叫。
import { handleAsk, type AskEnv, type LogEntry } from "./ask";
import type { Fetch } from "./upstream";
import { consume, type UsageLimiter, type UsageRecord } from "./usage";

export const ORIGIN = "https://demo.example";
export const CODE = "TEST1234";
// 假的金鑰，用來確認不會出現在回應與 log
export const API_KEY = "fake-api-key-for-tests";
export const env: AskEnv = {
  ANTHROPIC_API_KEY: API_KEY,
  ACCESS_CODES: `sales:${CODE},TEST5678;off:OFF12345`,
  DISABLED_GROUPS: "off",
  DAILY_LIMIT: "2",
};
export const body = { model: "standard", messages: [{ role: "user", content: "你好" }] };

export function memoryUsage() {
  const records = new Map<string, UsageRecord>();
  const calls: { key: string; date: string; limit: number }[] = [];
  const usage: UsageLimiter = {
    async consume(key, date, limit) {
      calls.push({ key, date, limit });
      const r = consume(records.get(key), date, limit);
      records.set(key, r.record);
      return r.allowed;
    },
  };
  return { usage, calls };
}

export function sse(events: [string, unknown][]): string {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

// 依 https://platform.claude.com/docs/en/build-with-claude/streaming 的事件順序
export function upstreamEvents(texts: string[], stopReason = "end_turn"): [string, unknown][] {
  return [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [] } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "內部推理" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["ping", { type: "ping" }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
    ...texts.map((text): [string, unknown] => ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text } }]),
    ["content_block_stop", { type: "content_block_stop", index: 1 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 10 } }],
    ["message_stop", { type: "message_stop" }],
  ];
}

export function streamOf(chunks: string[], options: { fail?: boolean } = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else if (options.fail) controller.error(new Error("connection reset"));
      else controller.close();
    },
  });
}

export function fakeUpstream(make: () => Response = () => okResponse(sse(upstreamEvents(["你好"])))) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    requests.push({ url, init });
    return make();
  };
  return { fetch, requests };
}

export function okResponse(text: string | ReadableStream<Uint8Array>): Response {
  return new Response(typeof text === "string" ? streamOf([text]) : text, {
    headers: { "content-type": "text/event-stream", "request-id": "req_test_1" },
  });
}

export function ask(
  options: {
    headers?: Record<string, string>;
    body?: unknown;
    env?: AskEnv;
    usage?: UsageLimiter;
    now?: Date;
    fetch?: Fetch;
    logs?: LogEntry[];
  } = {},
) {
  const request = new Request(`${ORIGIN}/api/ask`, {
    method: "POST",
    headers: { Origin: ORIGIN, "X-Access-Code": CODE, "Content-Type": "application/json", ...options.headers },
    body: typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? body),
  });
  return handleAsk(request, options.env ?? env, {
    usage: options.usage ?? memoryUsage().usage,
    now: () => options.now ?? new Date("2026-10-28T12:00:00Z"),
    fetch: options.fetch ?? fakeUpstream().fetch,
    log: (entry) => options.logs?.push(entry),
  });
}
