// 問答與 /api/ask 之間的接口（格式見 worker/README.md）。真的實作是 api.ts；測試用 testing.ts 的假實作，不呼叫真實 API。
import type { ModelCode } from "../client/types";

export interface AskBody {
  model: ModelCode;
  system: string;
  messages: { role: "user"; content: string }[];
}

// /api/ask 的 SSE 事件。串流開始前的錯誤（HTTP 錯誤、連不上）也轉成 error 事件
export type AskEvent =
  | { type: "delta"; text: string }
  | { type: "done"; stopReason: string }
  | { type: "error"; error: string };

export interface AskTransport {
  // signal 中止時結束串流、取消連線，不再送出事件（例如切換身分時捨棄進行中的回答）
  send(body: AskBody, signal?: AbortSignal): AsyncIterable<AskEvent>;
}
