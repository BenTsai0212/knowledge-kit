// 原文紙面（#225）：文件中看得到的段落，引用段落以螢光標出；桌機的原文面板（SourcePanel）與手機的底部面板（SourceSheet，#256）共用。
import { Fragment, useEffect, useRef } from "react";
import { fill, strings } from "../client/i18n";
import type { ConfirmationAction } from "../sources/confirmations";
import type { SourceDocument } from "../sources/source";
import { PassageMarks } from "./PassageMarks";
import { pairKey, pairRecords } from "./seam-records";
import { SeamRecords } from "./SeamRecords";
import { SourceConfirmation } from "./SourceConfirmation";

interface Props {
  language: string;
  source: SourceDocument;
  // 點擊段落旁的標示（說法不同、取代，#51）時打開另一段
  onOpenSource(passageId: string): void;
  // 桌機的原文欄（#335）：段落前加「¶N」（N 是這個身分看得到的段落的順序，不透露看不到的段落）
  numbered?: boolean;
  // 確認、撤銷確認一段（ADR 0013）：source.confirmable 時才顯示按鈕；寫入並重新讀取原文後 resolve
  onConfirm?(passageId: string, action: ConfirmationAction): Promise<void>;
}

export function SourceText({ language, source, onOpenSource, numbered = false, onConfirm }: Props) {
  const s = strings(language);
  const highlighted = useRef<HTMLParagraphElement>(null);
  // 面板打開時的段落：螢光等面板進場後才刷過；面板已開著時換段落，標號變實心後就刷過（#227）
  const entering = useRef(source.highlight).current;
  // 不可寫成 () => …scrollIntoView()：新版瀏覽器的 scrollIntoView 回傳 Promise，React 會把它當成 cleanup 呼叫而出錯
  useEffect(() => {
    void highlighted.current?.scrollIntoView({ block: "nearest" });
  }, [source]);
  // 撤銷沒有標示的段落後，那段沒有「確認這段」可接焦點：焦點留在原文紙面上，不掉到頁面最前面
  const paper = useRef<HTMLDivElement>(null);
  const focusText = () => paper.current?.focus();

  // Dark 也是亮色的 reading 底
  return (
    <div ref={paper} tabIndex={-1} className={numbered ? "source-text source-text--numbered" : "source-text"} lang={source.language}>
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
        // 來源確認（ADR 0013 決定 8）：段落下方，與「記錄」同一區。「確認這段」只在這次打開的出處段落（螢光標示），
        // 換出處時跟著走；已確認的段落不論是否標示都顯示紀錄，能確認的身分在那裡也能撤銷
        const writable = source.confirmable === true && onConfirm !== undefined && (p.id === source.highlight || p.confirmation !== undefined);
        const confirmation = (
          <SourceConfirmation
            language={language}
            confirmation={p.confirmation}
            onConfirm={writable ? (action) => onConfirm(p.id, action) : undefined}
            onOpenSource={onOpenSource}
            onFocusLost={focusText}
          />
        );
        // 原文欄的「記錄」（ADR 0012 決定 6）：並存的段落下方，每一組一份（先作答或略過才看得到同事的理解）
        const records = source.records;
        const recordViews =
          records === undefined
            ? null
            : p.marks
                .filter((m) => m.kind === "conflict")
                .map((m) => (
                  <SeamRecords
                    key={`record-${m.passageId}`}
                    language={language}
                    items={pairRecords(records.items, p.id, m.passageId)}
                    skipped={records.skipped.includes(pairKey(p.id, m.passageId))}
                    title={s.dialogueRecordTitle}
                    showLocked
                  />
                ));
        if (!numbered)
          return (
            <Fragment key={p.id}>
              {text}
              {confirmation}
              {recordViews}
            </Fragment>
          );
        return (
          <div key={p.id} className="source-passage">
            <span className="source-passage__n" lang={language}>
              {fill(s.paragraphNumber, { n: i + 1 })}
            </span>
            {text}
            {confirmation}
            {recordViews}
          </div>
        );
      })}
    </div>
  );
}
