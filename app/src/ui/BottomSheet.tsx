// 底部面板（#255，docs/design.md「手機的共同結構」）：原生 <dialog> 的 showModal()（焦點移入、Esc、::backdrop 用 overlay），
// 圓角 24px、上方 40×5px 拖曳把手；往下拖、按關閉或 Esc 關閉，關閉後焦點回到打開它的元件。
// 開關用 base：進場是 app.css 的 kSheetUp，退場由 closeDialog() 播放反向動畫後才 close()；減少動態效果時直接到位。
// expandable（#257 的實體面板）：打開時停在 56% 高，往上拉到全高，從全高往下拉回 56%，從 56% 往下拉過門檻才關閉（layout.ts 的 sheetSnap()）。
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { strings } from "../client/i18n";
import { CLOSING_CLASS, closeDialog } from "./dialog-motion";
import { sheetDragCloses, sheetSnap, type SheetStop } from "./layout";
import { MOTION, prefersReducedMotion } from "./motion";

interface Props {
  open: boolean;
  // 面板關閉後呼叫（Esc、關閉按鈕、往下拖、點背景，或 open 改成 false）
  onClose(): void;
  title: string;
  language: string;
  className?: string;
  // 可展開：停在 56% 高、可往上拉到全高（沒有時高度依內容）
  expandable?: boolean;
  // 標題列中、關閉按鈕前的按鈕（例如原文面板的上一個、下一個出處，#256）
  actions?: ReactNode;
  children: ReactNode;
}

const close = (d: HTMLDialogElement) => closeDialog(d, prefersReducedMotion(), setTimeout, MOTION.base);

export function BottomSheet({ open, onClose, title, language, className, expandable = false, actions, children }: Props) {
  const s = strings(language);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const drag = useRef<{ start: number; dy: number; height: number } | null>(null);
  const titleId = useId();
  const [stop, setStop] = useState<SheetStop>("half");

  useEffect(() => {
    const d = dialog.current;
    if (d === null) return;
    if (open && !d.open) {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.style.removeProperty("transform");
      setStop("half");
      d.showModal();
    }
    if (!open && d.open) close(d);
  }, [open]);

  // 拖曳把手與標題列：往下拖時面板跟著手指，放開時超過門檻就關閉，否則彈回；可展開時往上拖面板跟著變高
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const d = dialog.current;
    if (d === null || d.classList.contains(CLOSING_CLASS) || (e.target as HTMLElement).closest("button") !== null) return;
    // 進場動畫（kSheetUp）播放中時 CSS 動畫會蓋過行內的 transform，面板不會跟著手指；先讓動畫直接到位
    d.getAnimations?.().forEach((a) => a.finish());
    drag.current = { start: e.clientY, dy: 0, height: d.getBoundingClientRect().height };
    // 拖曳中面板直接跟著手指（不套用高度的 transition）
    d.style.transition = "none";
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dialog.current;
    if (drag.current === null || d === null) return;
    const dy = e.clientY - drag.current.start;
    drag.current.dy = expandable ? dy : Math.max(0, dy);
    if (drag.current.dy >= 0) {
      d.style.removeProperty("height");
      d.style.transform = `translateY(${drag.current.dy}px)`;
    } else {
      d.style.removeProperty("transform");
      d.style.height = `${Math.min(drag.current.height - drag.current.dy, globalThis.innerHeight)}px`;
    }
  };
  const onPointerUp = () => {
    const d = dialog.current;
    const { dy = 0, height = 0 } = drag.current ?? {};
    drag.current = null;
    if (d === null) return;
    d.style.removeProperty("transition");
    d.style.removeProperty("height");
    const next = expandable ? sheetSnap(stop, dy, height) : sheetDragCloses(dy, height) ? "close" : stop;
    if (next === "close") return close(d);
    d.style.removeProperty("transform");
    setStop(next);
  };
  const classes = ["bottom-sheet", expandable && "is-expandable", expandable && stop === "full" && "is-full", className].filter(Boolean).join(" ");

  return (
    <dialog
      ref={dialog}
      className={classes}
      data-stop={expandable ? stop : undefined}
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
          <div className="bottom-sheet__actions">
            {actions}
            <button type="button" className="secondary" onClick={() => dialog.current !== null && close(dialog.current)}>
              {s.dialogClose}
            </button>
          </div>
        </div>
        {children}
      </div>
    </dialog>
  );
}
