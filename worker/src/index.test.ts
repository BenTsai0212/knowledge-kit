import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { UsageCounter, type Env } from "./index";
import { API_KEY, body, CODE, env as askEnv, okResponse, ORIGIN, sse, upstreamEvents } from "./testing";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// 以 UsageCounter 本身與記憶體 storage 代替 Durable Object
function fakeNamespace(): DurableObjectNamespace {
  const data = new Map<string, unknown>();
  const storage = { get: async (k: string) => data.get(k), put: async (k: string, v: unknown) => void data.set(k, v) };
  const counter = new UsageCounter({ storage } as unknown as DurableObjectState);
  return {
    idFromName: (name: string) => name,
    get: () => ({ fetch: (input: string, init: RequestInit) => counter.fetch(new Request(input, init)) }),
  } as unknown as DurableObjectNamespace;
}

function makeEnv() {
  const fetch = vi.fn(async () => new Response("asset"));
  return { env: { ASSETS: { fetch } } as unknown as Env, fetch };
}

describe("worker", () => {
  it("GET /api/health 回傳 { ok: true }", async () => {
    const { env, fetch } = makeEnv();
    const res = await worker.fetch(new Request("http://localhost/api/health"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("未知的 /api/ 路徑回傳 404", async () => {
    const { env, fetch } = makeEnv();
    const res = await worker.fetch(new Request("http://localhost/api/unknown"), env);
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("其他路徑交給靜態檔", async () => {
    const { env, fetch } = makeEnv();
    const res = await worker.fetch(new Request("http://localhost/"), env);
    expect(await res.text()).toBe("asset");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("POST /api/ask 經由 Durable Object 計數後轉發，console 的 log 不含金鑰與邀請碼", async () => {
    const upstream = vi.fn(async () => okResponse(sse(upstreamEvents(["你好"]))));
    vi.stubGlobal("fetch", upstream);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const env = { ...askEnv, ASSETS: { fetch: vi.fn() }, USAGE: fakeNamespace() } as unknown as Env;
    const request = () =>
      new Request(`${ORIGIN}/api/ask`, { method: "POST", headers: { Origin: ORIGIN, "X-Access-Code": CODE }, body: JSON.stringify(body) });

    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const res = await worker.fetch(request(), env);
      await res.text();
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 429]);
    expect(upstream).toHaveBeenCalledTimes(2);
    const lines = log.mock.calls.map((args) => args.join(" "));
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l).status)).toEqual([200, 200, 429]);
    for (const line of lines) {
      expect(line).not.toContain(API_KEY);
      expect(line).not.toContain(CODE);
    }
  });

  it("GET /api/ask 回 405", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/ask`), { ASSETS: { fetch: vi.fn() } } as unknown as Env);
    expect(res.status).toBe(405);
  });
});
