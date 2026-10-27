import { describe, expect, it } from "vitest";
import type { LogEntry } from "./ask";
import { parseSse } from "./sse";
import { API_KEY, ask, body, CODE, fakeUpstream, okResponse, sse, streamOf, upstreamEvents } from "./testing";

// 把前端收到的 SSE 解析成 [事件, 資料]
async function events(res: Response): Promise<[string, unknown][]> {
  const out: [string, unknown][] = [];
  for await (const e of parseSse(res.body!)) out.push([e.event, JSON.parse(e.data)]);
  return out;
}

const errorJson = (status: number, type: string, message = "x") =>
  new Response(JSON.stringify({ type: "error", error: { type, message }, request_id: "req_err_1" }), { status });

describe("轉發", () => {
  it("模型、max_tokens、effort 依白名單；前端送來的其他欄位不送往上游", async () => {
    const upstream = fakeUpstream();
    await ask({
      fetch: upstream.fetch,
      body: { ...body, system: "只用段落回答", max_tokens: 100000, tools: [{ name: "x" }], temperature: 1, stream: false },
    });
    expect(upstream.requests).toHaveLength(1);
    const { url, init } = upstream.requests[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      output_config: { effort: "low" },
      stream: true,
      system: "只用段落回答",
      messages: [{ role: "user", content: "你好" }],
    });
  });

  it("金鑰只從 env 讀取，放在 x-api-key", async () => {
    const upstream = fakeUpstream();
    await ask({ fetch: upstream.fetch });
    expect(upstream.requests[0].init.headers).toEqual({
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
  });
});

describe("串流", () => {
  it("依序回傳文字與 done，不轉送 thinking", async () => {
    const res = await ask({ fetch: fakeUpstream(() => okResponse(sse(upstreamEvents(["青翼", "專案"])))).fetch });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.clone().text();
    expect(text).not.toContain("內部推理");
    expect(await events(res)).toEqual([
      ["delta", { text: "青翼" }],
      ["delta", { text: "專案" }],
      ["done", { stopReason: "end_turn" }],
    ]);
  });

  it("上游的資料被任意切開、使用 CRLF 時也能解析", async () => {
    const raw = sse(upstreamEvents(["第一段", "第二段"], "max_tokens")).replace(/\n/g, "\r\n");
    const bytes = new TextEncoder().encode(raw);
    const chunks: string[] = [];
    // 以位元組切開，中文字也會被切斷
    const decoder = new TextDecoder();
    for (let i = 0; i < bytes.length; i += 7) chunks.push(decoder.decode(bytes.slice(i, i + 7), { stream: true }));
    const res = await ask({ fetch: fakeUpstream(() => okResponse(streamOf(chunks))).fetch });
    expect(await events(res)).toEqual([
      ["delta", { text: "第一段" }],
      ["delta", { text: "第二段" }],
      ["done", { stopReason: "max_tokens" }],
    ]);
  });

  it.each([
    ["串流中的 overloaded_error", [["error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]], "upstream_overloaded"],
    ["串流中的其他錯誤", [["error", { type: "error", error: { type: "api_error", message: "x" } }]], "upstream_interrupted"],
    ["沒有 message_stop 就結束", [], "upstream_interrupted"],
  ] as [string, [string, unknown][], string][])("%s：先送出已收到的文字，再回 error", async (_name, tail, type) => {
    const head = upstreamEvents(["前半"]).slice(0, 7);
    const res = await ask({ fetch: fakeUpstream(() => okResponse(sse([...head, ...tail]))).fetch });
    expect(res.status).toBe(200);
    expect(await events(res)).toEqual([
      ["delta", { text: "前半" }],
      ["error", { type }],
    ]);
  });

  it("連線中斷回 upstream_interrupted", async () => {
    const head = sse(upstreamEvents(["前半"]).slice(0, 7));
    const res = await ask({ fetch: fakeUpstream(() => okResponse(streamOf([head], { fail: true }))).fetch });
    expect(await events(res)).toEqual([
      ["delta", { text: "前半" }],
      ["error", { type: "upstream_interrupted" }],
    ]);
  });

  it("stop_reason 為 refusal 時回 upstream_refusal", async () => {
    const res = await ask({ fetch: fakeUpstream(() => okResponse(sse(upstreamEvents([], "refusal")))).fetch });
    expect(await events(res)).toEqual([["error", { type: "upstream_refusal" }]]);
  });

  it("前端中斷時停止讀取上游", async () => {
    let cancelled = false;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse(upstreamEvents(["a"]).slice(0, 7))));
      },
      cancel() {
        cancelled = true;
      },
    });
    const logs: LogEntry[] = [];
    const res = await ask({ fetch: fakeUpstream(() => okResponse(upstreamBody)).fetch, logs });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
    expect(logs.at(-1)?.error).toBe("upstream_interrupted");
  });
});

describe("上游的 HTTP 錯誤", () => {
  it.each([
    [429, "rate_limit_error", "x", 502, "upstream_quota"],
    [402, "billing_error", "x", 502, "upstream_quota"],
    [400, "invalid_request_error", "You have reached your specified workspace API usage limits (spend limit).", 502, "upstream_quota"],
    [400, "invalid_request_error", "messages: field required", 502, "upstream_error"],
    [529, "overloaded_error", "Overloaded", 503, "upstream_overloaded"],
    [504, "timeout_error", "x", 504, "upstream_timeout"],
    [500, "api_error", "x", 502, "upstream_error"],
    [401, "authentication_error", "invalid x-api-key", 502, "upstream_error"],
  ])("%i %s 回 %i %s", async (upstreamStatus, type, message, status, error) => {
    const logs: LogEntry[] = [];
    const res = await ask({ fetch: fakeUpstream(() => errorJson(upstreamStatus, type, message)).fetch, logs });
    expect({ status: res.status, body: await res.json() }).toEqual({ status, body: { error } });
    expect(logs).toEqual([
      { event: "ask", status, error, upstreamStatus, requestId: "req_err_1", group: "sales", model: "standard", promptChars: 2 },
    ]);
  });

  it("本文不是 JSON 時依狀態碼判斷", async () => {
    const res = await ask({ fetch: fakeUpstream(() => new Response("<html>", { status: 529 })).fetch });
    expect(await res.json()).toEqual({ error: "upstream_overloaded" });
  });

  it("連不到上游回 502 upstream_error", async () => {
    const res = await ask({
      fetch: async () => {
        throw new Error("network down");
      },
    });
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 502, body: { error: "upstream_error" } });
  });
});

describe("log", () => {
  it("每次請求一行，只有允許的欄位，不含金鑰、邀請碼與提示全文", async () => {
    const logs: LogEntry[] = [];
    const prompt = "青翼專案的上線日期是哪一天";
    const upstream = fakeUpstream(() => okResponse(sse(upstreamEvents(["答案"]))));
    const res = await ask({ fetch: upstream.fetch, logs, body: { ...body, system: "系統提示", messages: [{ role: "user", content: prompt }] } });
    const text = await res.text();
    await ask({ logs, headers: { "X-Access-Code": "WRONG123" } });

    expect(logs).toEqual([
      { event: "ask", status: 200, stopReason: "end_turn", upstreamStatus: 200, requestId: "req_test_1", group: "sales", model: "standard", promptChars: 17 },
      { event: "ask", status: 401, error: "invalid_access_code" },
    ]);
    const logged = JSON.stringify(logs);
    for (const secret of [API_KEY, CODE, "WRONG123", prompt, "系統提示"]) {
      expect(logged).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
  });
});
