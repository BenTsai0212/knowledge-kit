import { describe, expect, it } from "vitest";
import type { Retriever } from "../retrieval/retrieve";
import { errorMessage } from "../client/i18n";
import { ask, type QaContext } from "./answer";
import { apiTransport } from "./api";
import type { AskBody, AskEvent } from "./types";

const BODY: AskBody = { model: "standard", system: "s", messages: [{ role: "user", content: "q" }] };

// 依 chunks 逐段送出的 SSE 回應；可以在送完後丟出錯誤，模擬連線中斷
function sse(chunks: string[], fail = false): Response {
  const encoder = new TextEncoder();
  const queue = [...chunks];
  // 讀完全部 chunk 後才中斷（在 start 中呼叫 error 會丟掉還沒讀的 chunk）
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next !== undefined) controller.enqueue(encoder.encode(next));
      else if (fail) controller.error(new Error("reset"));
      else controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

async function collect(response: Response | (() => never)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = apiTransport({
    accessCode: "code-for-test",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return typeof response === "function" ? response() : response;
    },
  });
  const events: AskEvent[] = [];
  for await (const e of transport.send(BODY)) events.push(e);
  return { events, calls };
}

describe("apiTransport", () => {
  it("以 POST 送到 /api/ask，邀請碼放在 header、不放網址", async () => {
    const { calls } = await collect(sse(['event: done\ndata: {"stopReason":"end_turn"}\n\n']));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/ask");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "Content-Type": "application/json", "X-Access-Code": "code-for-test" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual(BODY);
    expect(calls[0].url).not.toContain("code-for-test");
  });

  it("解析 delta 與 done；事件可以跨 chunk、使用 \\r\\n，注解行與不認得的事件忽略", async () => {
    const { events } = await collect(
      sse([
        ": ping\n\nevent: delta\r\ndata: {\"te",
        'xt":"一年"}\r\n\r\nevent: ping\ndata: {}\n\n',
        'event: delta\ndata: {"text":"有 7 天"}\n\nevent: done\ndata: {"stopReason":"end_turn"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { type: "delta", text: "一年" },
      { type: "delta", text: "有 7 天" },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("串流中的 error 事件回傳其類型，之後的事件不再讀取", async () => {
    const { events } = await collect(
      sse(['event: delta\ndata: {"text":"一年"}\n\n', 'event: error\ndata: {"type":"upstream_overloaded"}\n\n', 'event: delta\ndata: {"text":"x"}\n\n']),
    );
    expect(events).toEqual([
      { type: "delta", text: "一年" },
      { type: "error", error: "upstream_overloaded" },
    ]);
  });

  it("串流開始前的錯誤：Worker 的 JSON 錯誤類型", async () => {
    for (const [status, error] of [
      [401, "invalid_access_code"],
      [429, "daily_limit"],
      [503, "upstream_overloaded"],
    ] as const) {
      const { events } = await collect(Response.json({ error }, { status }));
      expect(events).toEqual([{ type: "error", error }]);
    }
  });

  it("連不到伺服器時回 network", async () => {
    const { events } = await collect(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(events).toEqual([{ type: "error", error: "network" }]);
  });

  it("不是 JSON 的錯誤、不是 SSE 的成功回應、格式錯誤的事件都回 unexpected_response", async () => {
    for (const response of [
      new Response("<html>Bad Gateway</html>", { status: 502 }),
      new Response("<html>ok</html>", { headers: { "Content-Type": "text/html" } }),
      sse(["event: delta\ndata: not-json\n\n"]),
      sse(['event: delta\ndata: {"text":1}\n\n']),
    ]) {
      const { events } = await collect(response);
      expect(events).toEqual([{ type: "error", error: "unexpected_response" }]);
    }
  });

  it("連線中斷時保留已收到的事件，再回 upstream_interrupted", async () => {
    const { events } = await collect(sse(['event: delta\ndata: {"text":"一年"}\n\n'], true));
    expect(events).toEqual([
      { type: "delta", text: "一年" },
      { type: "error", error: "upstream_interrupted" },
    ]);
  });

  it("沒有 done 就結束時不補事件（由 ask() 視為中斷）", async () => {
    const { events } = await collect(sse(['event: delta\ndata: {"text":"一年"}\n\n']));
    expect(events).toEqual([{ type: "delta", text: "一年" }]);
  });
});

describe("apiTransport：中止", () => {
  // 與瀏覽器的 fetch 相同：signal 中止時，回應的串流以錯誤結束
  const abortable = (chunks: string[]) => async (_url: RequestInfo | URL, init?: RequestInit) => {
    const encoder = new TextEncoder();
    const queue = [...chunks];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
      pull(controller) {
        const next = queue.shift();
        if (next !== undefined) controller.enqueue(encoder.encode(next));
        // 之後的內容還沒送到，等待中止
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  };

  it("signal 傳給 fetch；中止後結束串流，不送出錯誤事件", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | null | undefined;
    const fetchWith = abortable(['event: delta\ndata: {"text":"一年"}\n\n']);
    const transport = apiTransport({ accessCode: "code-for-test", fetch: (url, init) => ((signal = init?.signal), fetchWith(url, init)) });
    const events: AskEvent[] = [];
    for await (const e of transport.send(BODY, controller.signal)) {
      events.push(e);
      controller.abort();
    }
    expect(signal).toBe(controller.signal);
    expect(events).toEqual([{ type: "delta", text: "一年" }]);
  });

  it("送出前就中止時，fetch 失敗也不回 network", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = apiTransport({
      accessCode: "code-for-test",
      fetch: async (_url, init) => {
        if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
        throw new Error("unreachable");
      },
    });
    const events: AskEvent[] = [];
    for await (const e of transport.send(BODY, controller.signal)) events.push(e);
    expect(events).toEqual([]);
  });
});

describe("ask() 經由 apiTransport", () => {
  const retriever: Retriever = {
    retrieve: async () => [
      { id: "p-1", documentId: "d", documentTitle: "員工手冊", documentDate: null, language: "zh-TW", content: "到職滿一年有 7 天年假。", score: 0.9, supersededBy: null },
    ],
  };
  const ctx = (response: Response): QaContext => ({
    retriever,
    transport: apiTransport({ accessCode: "code-for-test", fetch: async () => response }),
    model: "standard",
    displayName: { "zh-TW": "範例公司", en: "Example Co." },
  });
  const question = { identityId: "staff", text: "年假幾天？", language: "zh-TW" };

  it("串流中斷時保留已收到的內容、標示不完整，並附上使用者看得懂的訊息", async () => {
    const answer = await ask(ctx(sse(['event: delta\ndata: {"text":"一年有 7 天 [1]"}\n\n'], true)), question);
    expect(answer).toMatchObject({ kind: "answer", text: "一年有 7 天 [1]", cited: ["p-1"], incomplete: true, error: "upstream_interrupted" });
    if (answer.kind === "answer") expect(errorMessage("zh-TW", answer.error!)).toBe("回答在傳送途中中斷，請再試一次。");
  });

  it("串流開始前的錯誤對應到訊息", async () => {
    const answer = await ask(ctx(Response.json({ error: "daily_limit" }, { status: 429 })), question);
    expect(answer).toEqual({ kind: "error", error: "daily_limit" });
    if (answer.kind === "error") expect(errorMessage("en", answer.error)).toBe("You've reached today's question limit. Please try again tomorrow.");
  });
});
