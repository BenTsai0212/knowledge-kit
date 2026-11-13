import type { SourceDocument } from "../sources/source";
import { AccessBadges } from "./AccessBadges";
import { SourceText } from "./SourceText";
import { strings } from "../client/i18n";

interface Props {
  language: string;
  source: SourceDocument;
  // 點擊段落旁的標示（說法不同、取代，#51）時打開另一段
  onOpenSource(passageId: string): void;
  onClose(): void;
}

// 桌機的原文面板（右欄）；手機改用底部面板（SourceSheet，#256）
export function SourcePanel({ language, source, onOpenSource, onClose }: Props) {
  const s = strings(language);
  return (
    <aside className="card source" aria-label={s.sourceTitle}>
      <header>
        <h2>
          {s.sourceTitle}
          {s.colon}
          {source.title} <AccessBadges visibility={source.visibility} project={source.project} language={language} />
        </h2>
        <button type="button" className="link" onClick={onClose}>
          {s.closeSource}
        </button>
      </header>
      {/* 原文紙面（#225）：Dark 也是亮色的 reading 底 */}
      <SourceText language={language} source={source} onOpenSource={onOpenSource} />
    </aside>
  );
}
