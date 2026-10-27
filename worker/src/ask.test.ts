import { describe, expect, it } from "vitest";
import { handleAsk } from "./ask";
import { ask, body, CODE, env, fakeUpstream, memoryUsage, ORIGIN } from "./testing";
import type { UsageLimiter } from "./usage";

async function expectOk(res: Response | Promise<Response>) {
  const r = await res;
  expect(r.status).toBe(200);
  expect(await r.text()).toContain("event: done");
}

async function expectError(res: Response | Promise<Response>, status: number, error: string) {
  const r = await res;
  expect({ status: r.status, body: await r.json() }).toEqual({ status, body: { error } });
}

describe("同站", () => {
  it("同站請求通過所有檢查", async () => {
    await expectOk(ask({ headers: { "Sec-Fetch-Site": "same-origin" } }));
  });

  it.each([
    ["跨站的 Origin", { Origin: "https://evil.example" }],
    ["同 origin 但 Sec-Fetch-Site 是 cross-site", { "Sec-Fetch-Site": "cross-site" }],
    ["同 origin 但 Sec-Fetch-Site 是 same-site", { "Sec-Fetch-Site": "same-site" }],
  ])("%s 回 403", async (_name, headers) => {
    await expectError(ask({ headers }), 403, "forbidden_origin");
  });

  it("缺少 Origin 回 403", async () => {
    const request = new Request(`${ORIGIN}/api/ask`, { method: "POST", headers: { "X-Access-Code": CODE }, body: JSON.stringify(body) });
    await expectError(handleAsk(request, env, { usage: memoryUsage().usage, now: () => new Date(), fetch: fakeUpstream().fetch, log: () => {} }), 403, "forbidden_origin");
  });

  it("ALLOWED_ORIGINS 內的 Origin 通過，清單外仍回 403", async () => {
    const withDev = { ...env, ALLOWED_ORIGINS: "http://localhost:5173, http://127.0.0.1:5173" };
    await expectOk(ask({ env: withDev, headers: { Origin: "http://localhost:5173", "Sec-Fetch-Site": "same-site" } }));
    await expectError(ask({ env: withDev, headers: { Origin: "http://localhost:3000" } }), 403, "forbidden_origin");
  });
});

describe("邀請碼", () => {
  it.each([
    ["沒有邀請碼", { "X-Access-Code": "" }],
    ["錯誤的邀請碼", { "X-Access-Code": "WRONG123" }],
    ["停用組的邀請碼", { "X-Access-Code": "OFF12345" }],
  ])("%s 回 401", async (_name, headers) => {
    await expectError(ask({ headers }), 401, "invalid_access_code");
  });

  it("未設定金鑰或 ACCESS_CODES、ACCESS_CODES 格式錯誤時回 500，回應不含碼", async () => {
    await expectError(ask({ env: {} }), 500, "misconfigured");
    await expectError(ask({ env: { ...env, ANTHROPIC_API_KEY: "" } }), 500, "misconfigured");
    await expectError(ask({ env: { ...env, ACCESS_CODES: undefined } }), 500, "misconfigured");
    const res = await ask({ env: { ...env, ACCESS_CODES: `a:${CODE};b:${CODE}` } });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain(CODE);
  });

  it.each([["DAILY_LIMIT", "0"], ["DAILY_LIMIT", "abc"], ["MAX_PROMPT_CHARS", "-1"]])("%s=%s 回 500", async (name, value) => {
    await expectError(ask({ env: { ...env, [name]: value } }), 500, "misconfigured");
  });
});

describe("body", () => {
  it.each([
    ["不是 JSON", "{"],
    ["不是物件", [1]],
    ["沒有 messages", { model: "standard" }],
    ["messages 是空的", { model: "standard", messages: [] }],
    ["role 不正確", { model: "standard", messages: [{ role: "system", content: "x" }] }],
    ["content 不是字串", { model: "standard", messages: [{ role: "user", content: [{ type: "text" }] }] }],
    ["最後一則不是 user", { model: "standard", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }],
    ["system 不是字串", { ...body, system: 1 }],
  ])("%s 回 400 invalid_request", async (_name, b) => {
    await expectError(ask({ body: b }), 400, "invalid_request");
  });

  it("未知的模型代號回 400，前端送來的實際模型名稱也不採用", async () => {
    await expectError(ask({ body: { ...body, model: "fast" } }), 400, "unknown_model");
    await expectError(ask({ body: { ...body, model: "claude-fable-5-1" } }), 400, "unknown_model");
  });

  it("提示超過 MAX_PROMPT_CHARS 回 400（system 也算）", async () => {
    const limited = { ...env, MAX_PROMPT_CHARS: "10" };
    await expectError(ask({ env: limited, body: { ...body, system: "123456789" } }), 400, "prompt_too_long");
    await expectOk(ask({ env: limited, body: { ...body, system: "12345678" } }));
  });

  it("預設上限是 20,000 字元", async () => {
    const at = (n: number) => ({ model: "standard", messages: [{ role: "user", content: "字".repeat(n) }] });
    await expectOk(ask({ body: at(20_000) }));
    await expectError(ask({ body: at(20_001) }), 400, "prompt_too_long");
  });
});

describe("每日次數", () => {
  it("超過 DAILY_LIMIT 回 429，換日（UTC）後恢復", async () => {
    const { usage } = memoryUsage();
    const day1 = new Date("2026-10-28T23:59:00Z");
    await expectOk(ask({ usage, now: day1 }));
    await expectOk(ask({ usage, now: day1 }));
    await expectError(ask({ usage, now: day1 }), 429, "daily_limit");
    await expectOk(ask({ usage, now: new Date("2026-10-29T00:00:00Z") }));
  });

  it("每個邀請碼分別計數，以碼的雜湊值為鍵", async () => {
    const { usage, calls } = memoryUsage();
    await ask({ usage });
    await ask({ usage });
    await expectError(ask({ usage }), 429, "daily_limit");
    await expectOk(ask({ usage, headers: { "X-Access-Code": "TEST5678" } }));
    expect(new Set(calls.map((c) => c.key)).size).toBe(2);
    expect(calls.every((c) => /^[0-9a-f]{64}$/.test(c.key) && c.date === "2026-10-28" && c.limit === 2)).toBe(true);
  });

  it("預設上限是 30", async () => {
    const { usage, calls } = memoryUsage();
    await ask({ usage, env: { ...env, DAILY_LIMIT: undefined } });
    expect(calls[0].limit).toBe(30);
  });

  it("檢查失敗的請求不計入次數，也不呼叫上游", async () => {
    const { usage, calls } = memoryUsage();
    const upstream = fakeUpstream();
    await ask({ usage, fetch: upstream.fetch, headers: { "X-Access-Code": "WRONG123" } });
    await ask({ usage, fetch: upstream.fetch, body: { ...body, model: "fast" } });
    await ask({ usage, fetch: upstream.fetch, headers: { Origin: "https://evil.example" } });
    expect(calls).toEqual([]);
    expect(upstream.requests).toEqual([]);
  });

  it("Durable Object 無法使用時回 503", async () => {
    const broken: UsageLimiter = { consume: async () => { throw new Error("exceeded"); } };
    const upstream = fakeUpstream();
    await expectError(ask({ usage: broken, fetch: upstream.fetch }), 503, "limit_unavailable");
    expect(upstream.requests).toEqual([]);
  });
});
