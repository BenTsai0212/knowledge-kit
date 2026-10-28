import { describe, expect, it } from "vitest";
import { PROMPT_CHAR_BUDGET, promptChars } from "../qa/prompt";
import { planBatches } from "./batch";
import { extractionUserMessage } from "./prompt";

const SYSTEM = "s".repeat(2000);
const passages = (n: number, chars: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, content: "字".repeat(chars) }));

describe("planBatches", () => {
  it("短文件只有一批", () => {
    expect(planBatches(passages(3, 100), SYSTEM, 3)).toEqual({ batches: [["p1", "p2", "p3"]], skipped: [] });
  });

  it("每批都在 PROMPT_CHAR_BUDGET 內，段落依順序、不跨批，不遺漏", () => {
    const all = passages(60, 600);
    const { batches, skipped } = planBatches(all, SYSTEM, 10);
    expect(batches.length).toBeGreaterThan(1);
    expect(skipped).toEqual([]);
    expect(batches.flat()).toEqual(all.map((p) => p.id));
    for (const b of batches) {
      const user = extractionUserMessage(b.map((id) => all.find((p) => p.id === id)!));
      expect(promptChars({ system: SYSTEM, user })).toBeLessThanOrEqual(PROMPT_CHAR_BUDGET);
    }
  });

  it("超過批數上限的段落不萃取，依原本的順序列出", () => {
    const all = passages(60, 600);
    const { batches, skipped } = planBatches(all, SYSTEM, 2);
    expect(batches).toHaveLength(2);
    expect([...batches.flat(), ...skipped]).toEqual(all.map((p) => p.id));
    expect(skipped[0]).toBe(`p${batches.flat().length + 1}`);
  });

  it("沒有段落時沒有批次", () => {
    expect(planBatches([], SYSTEM, 3)).toEqual({ batches: [], skipped: [] });
  });
});
