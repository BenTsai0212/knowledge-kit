import { describe, expect, it } from "vitest";
import { consume, UsageCounter, utcDate, type UsageRecord } from "./usage";

describe("consume", () => {
  it("上限內計入，達到上限後不再增加", () => {
    let record: UsageRecord | undefined;
    const results = [];
    for (let i = 0; i < 4; i++) {
      const r = consume(record, "2026-10-28", 3);
      record = r.record;
      results.push(r.allowed);
    }
    expect(results).toEqual([true, true, true, false]);
    expect(record).toEqual({ date: "2026-10-28", count: 3 });
  });

  it("換日後歸零", () => {
    expect(consume({ date: "2026-10-27", count: 3 }, "2026-10-28", 3)).toEqual({
      record: { date: "2026-10-28", count: 1 },
      allowed: true,
    });
  });
});

describe("utcDate", () => {
  it("以 UTC 日期換日（台灣時間早上 8 點）", () => {
    expect(utcDate(new Date("2026-10-28T07:59:59+08:00"))).toBe("2026-10-27");
    expect(utcDate(new Date("2026-10-28T08:00:00+08:00"))).toBe("2026-10-28");
  });
});

describe("UsageCounter", () => {
  it("以 storage 保存計數", async () => {
    const data = new Map<string, unknown>();
    const storage = { get: async (k: string) => data.get(k), put: async (k: string, v: unknown) => void data.set(k, v) };
    const counter = new UsageCounter({ storage } as unknown as DurableObjectState);
    const call = async () =>
      (await (await counter.fetch(new Request("https://usage/consume", { method: "POST", body: JSON.stringify({ date: "2026-10-28", limit: 2 }) }))).json()) as {
        allowed: boolean;
      };
    expect([(await call()).allowed, (await call()).allowed, (await call()).allowed]).toEqual([true, true, false]);
    expect(data.get("usage")).toEqual({ date: "2026-10-28", count: 2 });
  });
});
