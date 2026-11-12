// 核准或退回後短提示的計時（#48 審查）：時間到就呼叫 onExpire。
// 滑鼠停在提示上（hover）或鍵盤焦點在提示內（focus）時暫停；兩者都離開後重新計時（從頭計算）。
// onRun：暫停時以 false、重新計時時以 true 呼叫，讓底部的倒數線一起暫停、從頭播放（#246）
export type HoldReason = "hover" | "focus";

export interface ToastTimer {
  hold(reason: HoldReason): void;
  release(reason: HoldReason): void;
  cancel(): void;
}

export function createToastTimer(ms: number, onExpire: () => void, onRun?: (running: boolean) => void): ToastTimer {
  const holds = new Set<HoldReason>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const start = () => {
    stop();
    timer = setTimeout(() => {
      timer = undefined;
      done = true;
      onExpire();
    }, ms);
  };
  start();
  return {
    hold(reason) {
      if (done) return;
      const running = holds.size === 0;
      holds.add(reason);
      stop();
      if (running) onRun?.(false);
    },
    release(reason) {
      if (done || !holds.delete(reason) || holds.size > 0) return;
      start();
      onRun?.(true);
    },
    cancel() {
      done = true;
      stop();
    },
  };
}
