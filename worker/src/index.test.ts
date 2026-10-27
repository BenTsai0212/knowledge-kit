import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";

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
});
