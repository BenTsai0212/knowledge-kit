// 原文紙面（#225）：文件中看得到的段落，引用段落以螢光標出；桌機的原文面板（SourcePanel）與手機的底部面板（SourceSheet，#256）共用。
import { useEffect, useRef } from "react";
import { fill, strings } from "../client/i18n";
import type { SourceDocument } from "../sources/source";
import { PassageMarks } from "./PassageMarks";

interface Props {
  language: string;
  source: SourceDocument;
  // 點擊段落旁的標示（說法不同、取代，#51）時打開另一段
  onOpenSource(passageId: string): void;
  // 桌機的原文欄（#335）：段落前加「¶N」（N 是這個身分看得到的段落的順序，不透露看不到的段落）
  numbered?: boolean;
}

export function SourceText({ language, source, onOpenSource, numbered = false }: Props) {
  const s = strings(language);
  const highlighted = useRef<HTMLParagraphElement>(null);
  // 面板打開時的段落：螢光等面板進場後才刷過；面板已開著時換段落，標號變實心後就刷過（#227）
  const entering = useRef(source.highlight).current;
  // 不可寫成 () => …scrollIntoView()：新版瀏覽器的 scrollIntoView 回傳 Promise，React 會把它當成 cleanup 呼叫而出錯
  useEffect(() => {
    void highlighted.current?.scrollIntoView({ block: "nearest" });
  }, [source]);

  // Dark 也是亮色的 reading 底
  return (
    <div className={numbered ? "source-text source-text--numbered" : "source-text"} lang={source.language}>
      {source.passages.map((p, i) => {
        const marks = <PassageMarks marks={p.marks} language={language} onOpenSource={onOpenSource} />;
        const text =
          p.id === source.highlight ? (
            <p key={p.id} ref={highlighted} className="highlight">
              <mark className={p.id === entering ? "entering" : undefined}>{p.content}</mark> {marks}
            </p>
          ) : (
            <p key={p.id}>
              {p.content} {marks}
            </p>
          );
        if (!numbered) return text;
        return (
          <div key={p.id} className="source-passage">
            <span className="source-passage__n" lang={language}>
              {fill(s.paragraphNumber, { n: i + 1 })}
            </span>
            {text}
          </div>
        );
      })}
    </div>
  );
}
