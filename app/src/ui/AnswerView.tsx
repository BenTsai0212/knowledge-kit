import type { Ref } from "react";
import type { Answer } from "../qa/answer";
import { splitCitations } from "../qa/citations";
import { errorMessage, strings } from "../client/i18n";
import { refusalNextSteps, type RefusalStep } from "./refusal-next-steps";

export interface AnswerState {
  question: string;
  // 串流中到目前為止的文字
  streaming: string;
  // 結束後的結果
  answer?: Answer;
}

interface Props {
  // 元素 id（左側「這次的問題」捲到該題）
  id: string;
  ref?: Ref<HTMLElement>;
  language: string;
  state: AnswerState;
  // 目前身分能上傳、且上傳頁籤看得到時，拒答下方多一項上傳與「到上傳頁」按鈕
  canUpload: boolean;
  onOpenSource(passageId: string): void;
  onGotoUpload(): void;
}

export function AnswerView({ id, ref, language, state, canUpload, onOpenSource, onGotoUpload }: Props) {
  const s = strings(language);
  const { answer } = state;
  const stepText: Record<RefusalStep, string> = {
    rephrase: s.refusalNextRephrase,
    askPerson: s.refusalNextAskPerson,
    upload: s.refusalNextUpload,
  };

  return (
    <section id={id} ref={ref} className="card answer" aria-live="polite">
      <h2>{state.question}</h2>
      {answer === undefined && (
        <>
          <p className="answer-text">{state.streaming}</p>
          <p className="muted">{s.answering}</p>
        </>
      )}
      {answer?.kind === "refusal" && (
        <>
          <p className="answer-text">{answer.text}</p>
          {/* 下一步只依上傳能力決定，「資料沒寫」與「沒有權限」相同（docs/qa.md「拒答」） */}
          <div className="refusal-next">
            <p className="muted">{s.refusalNextTitle}</p>
            <ul>
              {refusalNextSteps({ canUpload }).map((step) => (
                <li key={step}>
                  {stepText[step]}
                  {step === "upload" && (
                    <>
                      {" "}
                      <button type="button" onClick={onGotoUpload}>
                        {s.refusalGotoUpload}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      {answer?.kind === "error" && <p className="error">{errorMessage(language, answer.error)}</p>}
      {answer?.kind === "answer" && (
        <>
          <p className="answer-text">
            {splitCitations(answer.text).map((segment, i) => {
              if ("text" in segment) return <span key={i}>{segment.text}</span>;
              const id = answer.numbering[segment.citation - 1];
              return (
                <button key={i} type="button" className="citation" title={s.openSource} onClick={() => onOpenSource(id)}>
                  {segment.citation}
                </button>
              );
            })}
          </p>
          {answer.uncited && <p className="badge warning">{s.uncited}</p>}
          {answer.incomplete && (
            <p className="badge warning">
              {s.incomplete}
              {answer.error !== undefined && `${s.colon}${errorMessage(language, answer.error)}`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
