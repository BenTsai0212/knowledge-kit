// 呼叫 /api/ask 的 AskTransport（格式見 worker/README.md）。邀請碼只放在 header，不放網址。
import { parseSse } from "./sse";
import type { AskEvent, AskTransport } from "./types";

export interface ApiOptions {
  accessCode: string;
  // 測試注入假的 fetch，不連網路
  fetch?: typeof fetch;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// 串流開始前的錯誤：Worker 回 JSON { error: "<類型>" }
async function errorType(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isObject(body) && typeof body.error === "string") return body.error;
  } catch {
    // 不是 JSON（例如代理伺服器的錯誤頁）
  }
  return "unexpected_response";
}

// 不認得的事件忽略；格式錯誤的事件視為非預期的回應
function toEvent(event: string, data: string): AskEvent | null | "invalid" {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return "invalid";
  }
  if (!isObject(value)) return "invalid";
  if (event === "delta") return typeof value.text === "string" ? { type: "delta", text: value.text } : "invalid";
  if (event === "done") return { type: "done", stopReason: typeof value.stopReason === "string" ? value.stopReason : "" };
  if (event === "error") return { type: "error", error: typeof value.type === "string" ? value.type : "upstream_interrupted" };
  return null;
}

export function apiTransport({ accessCode, fetch: request = (input, init) => fetch(input, init) }: ApiOptions): AskTransport {
  return {
    async *send(body, signal) {
      let response: Response;
      try {
        response = await request("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Access-Code": accessCode },
          body: JSON.stringify(body),
          signal,
        });
      } catch {
        if (signal?.aborted) return;
        yield { type: "error", error: "network" };
        return;
      }
      if (!response.ok) {
        yield { type: "error", error: await errorType(response) };
        return;
      }
      if (!response.headers.get("Content-Type")?.startsWith("text/event-stream") || response.body === null) {
        yield { type: "error", error: "unexpected_response" };
        return;
      }
      try {
        for await (const { event, data } of parseSse(response.body)) {
          const parsed = toEvent(event, data);
          if (parsed === null) continue;
          if (parsed === "invalid") {
            yield { type: "error", error: "unexpected_response" };
            return;
          }
          yield parsed;
          if (parsed.type !== "delta") return;
        }
      } catch {
        if (signal?.aborted) return;
        yield { type: "error", error: "upstream_interrupted" };
      }
      // 沒有 done 或 error 就結束時不補事件，由 ask() 視為中斷
    },
  };
}
