// 測試用的假 AskTransport：記下每次送出的 body，依 reply 回傳事件，不呼叫真實 API。
import type { AskBody, AskEvent, AskTransport } from "./types";

export interface FakeTransport extends AskTransport {
  bodies: AskBody[];
}

export function fakeTransport(reply: (body: AskBody) => AskEvent[] = () => answered("[1]")): FakeTransport {
  const bodies: AskBody[] = [];
  return {
    bodies,
    async *send(body, signal) {
      bodies.push(body);
      for (const event of reply(body)) {
        if (signal?.aborted) return;
        yield event;
      }
    },
  };
}

// 正常結束的回答；文字可以分成多段送出
export function answered(...deltas: string[]): AskEvent[] {
  return [...deltas.map((text) => ({ type: "delta" as const, text })), { type: "done", stopReason: "end_turn" }];
}
