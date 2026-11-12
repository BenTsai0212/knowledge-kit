// 底部面板（#255，docs/design.md「手機的共同結構」）：原生 <dialog> 的 showModal()（焦點移入、Esc、::backdrop 用 overlay），
// 圓角 24px、上方 40×5px 拖曳把手；往下拖、按關閉或 Esc 關閉，關閉後焦點回到打開它的元件。
// 開關用 base：進場是 app.css 的 kSheetUp，退場由 closeDialog() 播放反向動畫後才 close()；減少動態效果時直接到位。
import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from "react";
import { strings } from "../client/i18n";
import { CLOSING_CLASS, closeDialog } from "./dialog-motion";
import { sheetDragCloses } from "./layout";
import { MOTION, prefersReducedMotion } from "./motion";

interface Props {
  open: boolean;
  // 面板關閉後呼叫（Esc、關閉按鈕、往下拖、點背景，或 open 改成 false）
  onClose(): void;
  title: string;
  language: string;
  className?: string;
  children: ReactNode;
}

const close = (d: HTMLDialogElement) => closeDialog(d, prefersReducedMotion(), setTimeout, MOTION.base);

export function BottomSheet({ open, onClose, title, language, className, children }: Props) {
  const s = strings(language);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const drag = useRef<{ start: number; dy: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (d === null) return;
    if (open && !d.open) {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.style.removeProperty("transform");
      d.showModal();
    }
    if (!open && d.open) close(d);
  }, [open]);

  // 拖曳把手與標題列：往下拖時面板跟著手指，放開時超過門檻就關閉，否則彈回
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const d = dialog.current;
    if (d === null || d.classList.contains(CLOSING_CLASS) || (e.target as HTMLElement).closest("button") !== null) return;
    // 進場動畫（kSheetUp）播放中時 CSS 動畫會蓋過行內的 transform，面板不會跟著手指；先讓動畫直接到位
    d.getAnimations?.().forEach((a) => a.finish());
    drag.current = { start: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dialog.current;
    if (drag.current === null || d === null) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.start);
    d.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onPointerUp = () => {
    const d = dialog.current;
    const dy = drag.current?.dy ?? 0;
    drag.current = null;
    if (d === null) return;
    if (sheetDragCloses(dy, d.getBoundingClientRect().height)) close(d);
    else d.style.removeProperty("transform");
  };

  return (
    <dialog
      ref={dialog}
      className={className === undefined ? "bottom-sheet" : `bottom-sheet ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => (e.preventDefault(), close(e.currentTarget))}
      // 點背景（dialog 本身，不是內容）時關閉
      onClick={(e) => e.target === e.currentTarget && close(e.currentTarget)}
      onClose={() => {
        trigger.current?.focus();
        trigger.current = null;
        onClose();
      }}
    >
      <div className="bottom-sheet__body">
        <div className="bottom-sheet__header" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <span className="bottom-sheet__handle" aria-hidden="true" />
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="secondary" onClick={() => dialog.current !== null && close(dialog.current)}>
            {s.dialogClose}
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
