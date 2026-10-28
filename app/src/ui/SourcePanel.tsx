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
  useEffect(() => highlighted.current?.scrollIntoView({ block: "nearest" }), [source]);

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
