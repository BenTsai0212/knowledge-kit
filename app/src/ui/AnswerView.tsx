import type { Answer } from "../qa/answer";
import { splitCitations } from "../qa/citations";
import { errorMessage, strings } from "./strings";

export interface AnswerState {
  question: string;
  // 串流中到目前為止的文字
  streaming: string;
  // 結束後的結果
  answer?: Answer;
}

interface Props {
  language: string;
  state: AnswerState | null;
  onOpenSource(passageId: string): void;
}

export function AnswerView({ language, state, onOpenSource }: Props) {
  const s = strings(language);
  if (state === null) return <section className="card muted">{s.emptyAnswer}</section>;
  const { answer } = state;

  return (
    <section className="card answer" aria-live="polite">
      <h2>{state.question}</h2>
      {answer === undefined && (
        <>
          <p className="answer-text">{state.streaming}</p>
          <p className="muted">{s.answering}</p>
        </>
      )}
      {answer?.kind === "refusal" && <p className="answer-text">{answer.text}</p>}
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
