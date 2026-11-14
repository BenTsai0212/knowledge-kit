// 手機的原文面板（#256；平板是右側的滑出面板，#255，docs/design.md「問答（手機）」）：點引用標號時從底部升起（BottomSheet，高 74%）。
// 標題列是「原文 · 出處 N／M」小字（平板是「出處 N／M」）與上一個、下一個出處（44px）；原文在 reading 紙面、引用段落用 markReading、
// 其他段落 textMuted（SourceText，與桌機相同，#354）；下方是並排的「在圖譜中查看」與「回報有錯」（畫板 G-Mobile-QA）。不是從某一題的引用打開時（段落旁的標示、其他頁面）只顯示「原文」。
import { fill, strings } from "../client/i18n";
import type { SourceDocument } from "../sources/source";
import { AccessBadges } from "./AccessBadges";
import { BottomSheet } from "./BottomSheet";
import type { SourceSteps } from "./source-steps";
import { SourceText } from "./SourceText";

interface Props {
  language: string;
  source: SourceDocument;
  // 這一題的出處序號（source-steps.ts）；null 時不顯示 N／M 與上下按鈕
  steps: SourceSteps | null;
  // 上一個、下一個出處
  onStep(passageId: string): void;
  // 點擊段落旁的標示（說法不同、取代，#51）時打開另一段
  onOpenSource(passageId: string): void;
  // 「在圖譜中查看」：沒有時不顯示（source-steps.ts 的 sourceGraphTarget()）
  onViewInGraph?(): void;
  // 「回報有錯」：沒有時不顯示（展示模式與不能回報的題目）
  onReport?(): void;
  onClose(): void;
  // 平板是右側的滑出面板（#255）
  side?: "bottom" | "right";
}

export function SourceSheet({ language, source, steps, onStep, onOpenSource, onViewInGraph, onReport, onClose, side }: Props) {
  const s = strings(language);
  const step = (label: string, target: string | null, glyph: string) => (
    <button type="button" className="secondary source-step" aria-label={label} disabled={target === null} onClick={() => target !== null && onStep(target)}>
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={steps === null ? s.sourceTitle : fill(side === "right" ? s.sourceStep : s.sourceSheetStep, { n: steps.index, total: steps.total })}
      language={language}
      className="source-sheet"
      side={side}
      actions={
        steps !== null && (
          <>
            {step(s.sourcePrev, steps.prev, "‹")}
            {step(s.sourceNext, steps.next, "›")}
          </>
        )
      }
    >
      <p className="source-sheet__title">
        {source.title} <AccessBadges visibility={source.visibility} project={source.project} language={language} />
      </p>
      <SourceText language={language} source={source} onOpenSource={onOpenSource} />
      {(onViewInGraph !== undefined || onReport !== undefined) && (
        <p className="source-sheet__actions">
          {onViewInGraph !== undefined && (
            <button type="button" className="secondary" onClick={onViewInGraph}>
              {s.viewInGraph}
            </button>
          )}
          {onReport !== undefined && (
            <button type="button" className="chip" onClick={onReport}>
              {s.reportButton}
            </button>
          )}
        </p>
      )}
    </BottomSheet>
  );
}
