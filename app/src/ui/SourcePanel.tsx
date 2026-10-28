import { useEffect, useRef } from "react";
import type { SourceDocument } from "../sources/source";
import { strings } from "./strings";

interface Props {
  language: string;
  source: SourceDocument;
  onClose(): void;
}

export function SourcePanel({ language, source, onClose }: Props) {
  const s = strings(language);
  const highlighted = useRef<HTMLParagraphElement>(null);
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
          {source.title}
        </h2>
        <button type="button" className="link" onClick={onClose}>
          {s.closeSource}
        </button>
      </header>
      <div lang={source.language}>
        {source.passages.map((p) =>
          p.id === source.highlight ? (
            <p key={p.id} ref={highlighted} className="highlight">
              <mark>{p.content}</mark>
            </p>
          ) : (
            <p key={p.id}>{p.content}</p>
          ),
        )}
      </div>
    </aside>
  );
}
