// 對話框的退場（docs/design.md「全互動對照表」的「全域 · 對話框」，#246）：進場的反向，fast。
// 原生 <dialog> 的 close() 會立刻隱藏，所以先加上 is-closing 播放退場（app.css 的 .dialog.is-closing），時間到才 close()。
// 減少動態效果時直接 close()。退場中再次要求關閉不重複計時。底部面板的開關用 base（#255），以 ms 指定。
import { MOTION, motionDuration } from "./motion";

export const CLOSING_CLASS = "is-closing";

type ClosableDialog = Pick<HTMLDialogElement, "open" | "close" | "classList">;

export function closeDialog(
  dialog: ClosableDialog,
  reduced: boolean,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
  duration: number = MOTION.fast,
): void {
  if (!dialog.open || dialog.classList.contains(CLOSING_CLASS)) return;
  const ms = motionDuration(reduced, duration);
  if (ms === 0) return dialog.close();
  dialog.classList.add(CLOSING_CLASS);
  schedule(() => {
    dialog.classList.remove(CLOSING_CLASS);
    dialog.close();
  }, ms);
}
