import type { CitedSource, SourceDocument } from "../sources/source";
import { AccessBadges } from "./AccessBadges";
import { SourceText } from "./SourceText";
import { fill, strings } from "../client/i18n";

interface Props {
  language: string;
  source: SourceDocument;
  // 點擊段落旁的標示（說法不同、取代，#51）時打開另一段
  onOpenSource(passageId: string): void;
  // 「這次回答的出處」（#335）：從某一題的引用打開時才有；點了切換出處。目前的段落不在清單中時（段落旁的標示打開的另一段）只顯示「原文」
  cited: readonly CitedSource[] | null;
  onClose(): void;
}

// 桌機的原文欄（#335，畫板 QA）：貼齊右緣的整高欄；手機改用底部面板（SourceSheet，#256），平板是滑出面板（#255）
export function SourcePanel({ language, source, onOpenSource, cited, onClose }: Props) {
  const s = strings(language);
  const current = cited?.find((c) => c.passageId === source.highlight);
  return (
    <aside className="card source" aria-label={s.sourceTitle}>
      <header className="source__top">
        <p className="source__eyebrow">{current === undefined ? s.sourceTitle : fill(s.sourceHeading, { n: current.citation })}</p>
        <button type="button" className="icon-button" aria-label={s.closeSource} onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="source__doc">
        <h2>{source.title}</h2>
        <p>
          <AccessBadges visibility={source.visibility} project={source.project} language={language} />
        </p>
      </div>
      {/* 原文紙面（#225）：Dark 也是亮色的 reading 底 */}
      <SourceText language={language} source={source} onOpenSource={onOpenSource} numbered />
      {cited !== null && cited.length > 0 && (
        <nav className="source__cited" aria-label={s.sourceCitedList}>
          <p className="source__eyebrow">{s.sourceCitedList}</p>
          {cited.map((c) => (
            <button
              key={c.passageId}
              type="button"
              aria-current={c.passageId === source.highlight || undefined}
              onClick={() => c.passageId !== source.highlight && onOpenSource(c.passageId)}
            >
              <span className="source__citation">{c.citation}</span>
              <span>
                {c.title} {fill(s.paragraphNumber, { n: c.paragraph })}
              </span>
            </button>
          ))}
        </nav>
      )}
    </aside>
  );
}
