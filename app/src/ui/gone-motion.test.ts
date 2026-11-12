import { describe, expect, it } from "vitest";
import { GONE_MS, GONE_STAGGER, goneDelay, withGone } from "./gone-motion";
import { MOTION, STAGGER } from "./motion";

// 切換身分時看不到的內容（#246 決定補充 2）
const id = (x: string) => x;

describe("withGone", () => {
  it("消失的項目留在原本的位置，依上一份清單的順序編號；其餘補位", () => {
    expect(withGone(["a", "b", "c", "d"], ["a", "c"], id)).toEqual([
      { item: "a", gone: null },
      { item: "b", gone: 0 },
      { item: "c", gone: null },
      { item: "d", gone: 1 },
    ]);
  });

  it("新身分多看到的項目照新清單的順序出現，不標為消失", () => {
    expect(withGone(["b", "d"], ["a", "b", "c"], id)).toEqual([
      { item: "a", gone: null },
      { item: "b", gone: null },
      { item: "d", gone: 0 },
      { item: "c", gone: null },
    ]);
  });

  it("沒有少的項目時就是新清單", () => {
    expect(withGone(["a", "b"], ["a", "b"], id)).toEqual([
      { item: "a", gone: null },
      { item: "b", gone: null },
    ]);
    expect(withGone([], ["a"], id)).toEqual([{ item: "a", gone: null }]);
  });
});

describe("goneDelay", () => {
  it("420ms 是 expand＋fast，依序延後 40ms 是 stagger-sentence 的一半（motion-reference.md）", () => {
    expect(GONE_MS).toBe(420);
    expect(GONE_MS).toBe(MOTION.expand + MOTION.fast);
    expect(GONE_STAGGER).toBe(40);
    expect(GONE_STAGGER).toBe(STAGGER.sentence / 2);
  });

  it("等最後一個播完；第 7 個起與第 6 個同時", () => {
    expect(goneDelay(false, 0)).toBe(0);
    expect(goneDelay(false, 1)).toBe(420);
    expect(goneDelay(false, 3)).toBe(420 + 2 * 40);
    expect(goneDelay(false, 6)).toBe(420 + 5 * 40);
    expect(goneDelay(false, 20)).toBe(420 + 5 * 40);
  });

  it("減少動態效果時為 0：直接移除", () => {
    expect(goneDelay(true, 3)).toBe(0);
  });
});
