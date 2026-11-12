import { describe, expect, it } from "vitest";
import { CLOSING_CLASS, closeDialog } from "./dialog-motion";
import { MOTION } from "./motion";

// 只模擬 closeDialog 用到的部分
function fakeDialog() {
  const classes = new Set<string>();
  const dialog = {
    open: true,
    closed: 0,
    close() {
      dialog.open = false;
      dialog.closed++;
    },
    classList: {
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
  };
  return dialog;
}

const asDialog = (d: ReturnType<typeof fakeDialog>) => d as unknown as HTMLDialogElement;

describe("對話框的退場（#246）", () => {
  it("先加上 is-closing，fast 之後才關閉並移除", () => {
    const dialog = fakeDialog();
    const scheduled: { fn: () => void; ms: number }[] = [];
    closeDialog(asDialog(dialog), false, (fn, ms) => scheduled.push({ fn, ms }));
    expect(dialog.classList.contains(CLOSING_CLASS)).toBe(true);
    expect(dialog.open).toBe(true);
    expect(scheduled.map((x) => x.ms)).toEqual([MOTION.fast]);
    scheduled[0].fn();
    expect(dialog.open).toBe(false);
    expect(dialog.classList.contains(CLOSING_CLASS)).toBe(false);
  });

  it("減少動態效果時直接關閉，不加 is-closing", () => {
    const dialog = fakeDialog();
    const scheduled: unknown[] = [];
    closeDialog(asDialog(dialog), true, (fn) => scheduled.push(fn));
    expect(dialog.open).toBe(false);
    expect(dialog.classList.contains(CLOSING_CLASS)).toBe(false);
    expect(scheduled).toEqual([]);
  });

  it("退場中再次關閉、或已經關閉時，不重複計時", () => {
    const dialog = fakeDialog();
    const scheduled: (() => void)[] = [];
    const schedule = (fn: () => void) => scheduled.push(fn);
    closeDialog(asDialog(dialog), false, schedule);
    closeDialog(asDialog(dialog), false, schedule);
    expect(scheduled).toHaveLength(1);
    scheduled[0]();
    closeDialog(asDialog(dialog), false, schedule);
    expect(scheduled).toHaveLength(1);
    expect(dialog.closed).toBe(1);
  });
});
