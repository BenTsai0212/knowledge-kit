import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToastTimer } from "./toast-timer";

describe("createToastTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("時間到才呼叫 onExpire，只呼叫一次", () => {
    const expire = vi.fn();
    createToastTimer(10_000, expire);
    vi.advanceTimersByTime(9_999);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("hover 時暫停，離開後從頭重新計時", () => {
    const expire = vi.fn();
    const timer = createToastTimer(10_000, expire);
    vi.advanceTimersByTime(8_000);
    timer.hold("hover");
    vi.advanceTimersByTime(60_000);
    expect(expire).not.toHaveBeenCalled();
    timer.release("hover");
    vi.advanceTimersByTime(9_999);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("hover 與 focus 都離開後才重新計時", () => {
    const expire = vi.fn();
    const timer = createToastTimer(10_000, expire);
    timer.hold("hover");
    timer.hold("focus");
    timer.release("hover");
    vi.advanceTimersByTime(30_000);
    expect(expire).not.toHaveBeenCalled();
    timer.release("focus");
    vi.advanceTimersByTime(10_000);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("沒有 hold 過的 release 不影響計時", () => {
    const expire = vi.fn();
    const timer = createToastTimer(10_000, expire);
    vi.advanceTimersByTime(6_000);
    timer.release("focus");
    vi.advanceTimersByTime(4_000);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("cancel 後不再呼叫，之後的 release 也不重新計時", () => {
    const expire = vi.fn();
    const timer = createToastTimer(10_000, expire);
    timer.hold("hover");
    timer.cancel();
    timer.release("hover");
    vi.advanceTimersByTime(60_000);
    expect(expire).not.toHaveBeenCalled();
  });
});
