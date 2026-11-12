import { describe, expect, it } from "vitest";
import { conflictSettleDelay, exitOrder, exitThenWrite, RESULT_AT_MS, resultDelay, ROW_EXIT_MS, rowClass, rowExitDelay, withExit } from "./review-motion";

describe("待審頁的列退場（#243 PR 3）", () => {
  it("收合是 expand、往左淡出是 fast；減少動態效果時為 0", () => {
    expect(ROW_EXIT_MS).toEqual({ collapse: 300, out: 120, away: 220 });
    expect(rowExitDelay(false, "collapse")).toBe(300);
    expect(rowExitDelay(false, "out")).toBe(120);
    expect(rowExitDelay(true, "collapse")).toBe(0);
    expect(rowExitDelay(true, "out")).toBe(0);
  });

  it("先標記離開中，等動畫的時間之後才寫入", async () => {
    const log: string[] = [];
    const result = await exitThenWrite({
      delay: 300,
      wait: async (ms) => void log.push(`wait ${ms}`),
      mark: () => log.push("mark"),
      restore: () => log.push("restore"),
      write: async () => {
        log.push("write");
        return ["d1"];
      },
    });
    expect(result).toEqual(["d1"]);
    expect(log).toEqual(["mark", "wait 300", "write"]);
  });

  it("減少動態效果（delay 0）時不等待，立即寫入", async () => {
    const log: string[] = [];
    await exitThenWrite({
      delay: 0,
      wait: async () => void log.push("wait"),
      mark: () => log.push("mark"),
      restore: () => log.push("restore"),
      write: async () => void log.push("write"),
    });
    expect(log).toEqual(["mark", "write"]);
  });

  it("寫入失敗時列回到原狀，錯誤往外丟", async () => {
    const log: string[] = [];
    await expect(
      exitThenWrite({
        delay: 120,
        wait: async () => undefined,
        mark: () => log.push("mark"),
        restore: () => log.push("restore"),
        write: async () => {
          throw new Error("denied");
        },
      }),
    ).rejects.toThrow("denied");
    expect(log).toEqual(["mark", "restore"]);
  });

  it("列的 class：離開中優先於重新展開", () => {
    const leaving = withExit(new Map(), ["a"], "collapse");
    const both = withExit(leaving, ["b"], "out");
    expect(rowClass("a", both, new Set())).toBe("review-item is-collapsing");
    expect(rowClass("b", both, new Set(["b"]))).toBe("review-item is-leaving");
    expect(rowClass("c", both, new Set(["c"]))).toBe("review-item is-restored");
    expect(rowClass("d", both, new Set())).toBe("review-item");
    expect([...withExit(both, ["a"], null).keys()]).toEqual(["b"]);
    expect(both.size).toBe(2);
  });
});

describe("核准全部與說法不同（#243 PR 4）", () => {
  it("核准全部：各列依序往右離開（間隔 60ms），第 7 列起與第 6 列同時；最後一列播完才寫入", () => {
    expect(rowExitDelay(false, "away", 1)).toBe(220);
    expect(rowExitDelay(false, "away", 3)).toBe(220 + 2 * 60);
    expect(rowExitDelay(false, "away", 20)).toBe(220 + 5 * 60);
    expect(rowExitDelay(true, "away", 20)).toBe(0);
    // 收合與往左淡出不受列數影響
    expect(rowExitDelay(false, "collapse", 5)).toBe(300);
  });

  it("往右離開的順序依標記的順序，只算 away，超過 6 項不再延遲", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const leaving = withExit(withExit(new Map(), ["x"], "out"), ids, "away");
    expect(ids.map((id) => exitOrder(leaving, id))).toEqual([0, 1, 2, 3, 4, 5, 5, 5]);
    expect(rowClass("a", leaving, new Set())).toBe("review-item is-away");
  });

  it("核准結果在按下後 420ms 彈出：扣掉列離開的時間，不小於 0；減少動態效果時為 0", () => {
    expect(RESULT_AT_MS).toBe(420);
    expect(resultDelay(false, 220)).toBe(200);
    expect(resultDelay(false, 520)).toBe(0);
    expect(resultDelay(true, 220)).toBe(0);
  });

  it("說法不同：並存、取代播完才寫入；不是說法不同與減少動態效果時立即寫入", () => {
    expect(conflictSettleDelay(false, "coexist")).toBe(300 + 60 + 220);
    expect(conflictSettleDelay(false, "supersede")).toBe(200 + 220);
    expect(conflictSettleDelay(false, "not_conflict")).toBe(0);
    expect(conflictSettleDelay(true, "coexist")).toBe(0);
  });
});
