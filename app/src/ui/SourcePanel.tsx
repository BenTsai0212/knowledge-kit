import { useEffect, useRef } from "react";
import type { SourceDocument } from "../sources/source";
import { AccessBadges } from "./AccessBadges";
import { PassageMarks } from "./PassageMarks";
import { strings } from "../client/i18n";

interface Props {
  language: string;
  source: SourceDocument;
  // 點擊段落旁的標示（說法不同、取代，#51）時打開另一段
  onOpenSource(passageId: string): void;
  onClose(): void;
}

export function SourcePanel({ language, source, onOpenSource, onClose }: Props) {
  const s = strings(language);
  const highlighted = useRef<HTMLParagraphElement>(null);
  // 面板打開時的段落：螢光等面板滑入後才刷過；面板已開著時換段落，標號變實心後就刷過（#227）
  const entering = useRef(source.highlight).current;
  // 不可寫成 () => …scrollIntoView()：新版瀏覽器的 scrollIntoView 回傳 Promise，React 會把它當成 cleanup 呼叫而出錯
  useEffect(() => {
    void highlighted.current?.scrollIntoView({ block: "nearest" });
  }, [source]);

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
      <div className="source-text" lang={source.language}>
        {source.passages.map((p) => {
          const marks = <PassageMarks marks={p.marks} language={language} onOpenSource={onOpenSource} />;
          return p.id === source.highlight ? (
            <p key={p.id} ref={highlighted} className="highlight">
              <mark className={p.id === entering ? "entering" : undefined}>{p.content}</mark> {marks}
            </p>
          ) : (
            <p key={p.id}>
              {p.content} {marks}
            </p>
          );
        })}
      </div>
    </aside>
  );
}
