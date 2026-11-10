import type { Ref } from "react";
import { clientConfig } from "../client/load";
import type { Graph, GraphEntity } from "../graph/read";
import type { Answer } from "../qa/answer";
import { splitCitations } from "../qa/citations";
import { errorMessage, strings } from "../client/i18n";
import { entityOptionLabel, entityTypeLabel } from "./graph-labels";
import { refusalNextSteps, type RefusalStep } from "./refusal-next-steps";

export interface AnswerState {
  question: string;
  // 串流中到目前為止的文字
  streaming: string;
  // 結束後的結果
  answer?: Answer;
  // 回答提到的實體（#195）：以送出當下的身分讀出的圖譜，與從中挑出的實體（mentions.ts）
  mentions?: { graph: Graph; entities: GraphEntity[] };
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
  onOpenEntity(graph: Graph, entityId: string): void;
}

const { entityTypes } = clientConfig.knowledgeModel;

export function AnswerView({ id, ref, language, state, canUpload, onOpenSource, onGotoUpload, onOpenEntity }: Props) {
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
          {state.mentions !== undefined && state.mentions.entities.length > 0 && (
            <Mentions language={language} {...state.mentions} onOpenEntity={onOpenEntity} />
          )}
        </>
      )}
    </section>
  );
}

// 「回答提到」：依 knowledge-model.json 的類型順序分組；同名的實體加上第一個相關實體的名稱以便區分
function Mentions({ language, graph, entities, onOpenEntity }: { language: string; graph: Graph; entities: GraphEntity[]; onOpenEntity: Props["onOpenEntity"] }) {
  const s = strings(language);
  const types = [...new Set([...entityTypes.map((t) => t.id), ...entities.map((e) => e.type)])];
  return (
    <div className="mentions" role="group" aria-label={s.answerMentions}>
      <p className="muted">{s.answerMentions}</p>
      {types.map((type) => {
        const ofType = entities.filter((e) => e.type === type);
        if (ofType.length === 0) return null;
        return (
          <div key={type} className="mention-group">
            <span className="badge">{entityTypeLabel(type, language)}</span>
            {ofType.map((e) => (
              <button key={e.id} type="button" onClick={() => onOpenEntity(graph, e.id)}>
                {entityOptionLabel(graph, e, language)}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
