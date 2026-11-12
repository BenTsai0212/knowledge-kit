import { describe, expect, it } from "vitest";
import { exitThenWrite, ROW_EXIT_MS, rowClass, rowExitDelay, withExit } from "./review-motion";

describe("待審頁的列退場（#243 PR 3）", () => {
  it("收合是 expand、往左淡出是 fast；減少動態效果時為 0", () => {
    expect(ROW_EXIT_MS).toEqual({ collapse: 300, out: 120 });
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
