import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { graphStyle } from "./graph-style";
import { EXPAND_MS, motionDuration, PAN_MS, REDUCED_MOTION, watchReducedMotion } from "./motion";

describe("圖譜的動態（#199）", () => {
  it("動態約 0.2–0.5 秒；減少動態效果時為 0", () => {
    for (const ms of [EXPAND_MS, PAN_MS]) {
      expect(ms).toBeGreaterThanOrEqual(200);
      expect(ms).toBeLessThanOrEqual(500);
      expect(motionDuration(false, ms)).toBe(ms);
      expect(motionDuration(true, ms)).toBe(0);
    }
  });

  it("減少動態效果時，cytoscape 的 transition 時間為 0", () => {
    const durations = (reduced: boolean) =>
      (graphStyle(() => "", clientConfig.knowledgeModel.entityTypes, motionDuration(reduced, EXPAND_MS)) as unknown as { style: Record<string, unknown> }[])
        .map((r) => r.style["transition-duration"])
        .filter((d) => d !== undefined);
    expect(durations(false)).not.toEqual([]);
    expect(new Set(durations(false))).toEqual(new Set([EXPAND_MS]));
    expect(new Set(durations(true))).toEqual(new Set([0]));
  });

  it("讀出目前的設定，系統設定改變時通知，取消後不再通知", () => {
    const listeners = new Set<() => void>();
    const query = {
      matches: false,
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
    };
    const queries: string[] = [];
    const seen: boolean[] = [];
    const stop = watchReducedMotion((q) => (queries.push(q), query as unknown as MediaQueryList), (reduced) => seen.push(reduced));
    expect(queries).toEqual([REDUCED_MOTION]);
    query.matches = true;
    for (const fn of listeners) fn();
    expect(seen).toEqual([false, true]);
    stop();
    expect(listeners.size).toBe(0);
  });
});
