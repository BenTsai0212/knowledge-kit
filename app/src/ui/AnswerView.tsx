import { Fragment, useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { clientConfig } from "../client/load";
import type { Graph, GraphEntity } from "../graph/read";
import type { Answer } from "../qa/answer";
import { errorMessage, strings } from "../client/i18n";
import { entityOptionLabel, entityTypeLabel } from "./graph-labels";
import { MAX_REPORT_NOTE_CHARS, REPORT_CATEGORIES, type ReportCategory } from "../reports/store";
import { refusalNextSteps, type RefusalStep } from "./refusal-next-steps";
import { canReport, defaultCategory } from "./report-helpers";
import { answerDoneStep, answerSentences, sentenceStep, streamingSentences } from "./answer-motion";
import { staggerIndex } from "./motion";

export interface AnswerState {
  question: string;
  // 串流中到目前為止的文字
  streaming: string;
  // 結束後的結果
  answer?: Answer;
  // 回答提到的實體（#195）：以送出當下的身分讀出的圖譜，與從中挑出的實體（mentions.ts）
  mentions?: { graph: Graph; entities: GraphEntity[] };
}

// 目前在右側實體面板中的實體（#198）：同一題的圖譜與實體 id 都相同時，「回答提到」的按鈕為選取狀態
export interface OpenEntity {
  graph: Graph;
  id: string;
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
  // 目前在原文面板中的段落（#225）：引用標號顯示「選取」狀態
  openPassage: string | null;
  onGotoUpload(): void;
  onOpenEntity(graph: Graph, entityId: string): void;
  openEntity: OpenEntity | null;
  // 「回報有錯」（ADR 0007 決定 7）：寫入失敗時 reject
  onReport(category: ReportCategory, note: string): Promise<void>;
  // 回答中斷或失敗時的「重新提問」：以同一個問題再問一次（新的一題）；回答中不能按
  onRetry(): void;
  retryDisabled: boolean;
}

const { entityTypes } = clientConfig.knowledgeModel;

// 回答完成後已播過動態的題目：切換頁籤回來重新掛載時不再播放（#227）
const settled = new Set<string>();

// 不重試的錯誤：問題本身的錯誤，重新送出結果相同
const NOT_RETRYABLE = new Set(["empty_question", "question_too_long"]);

export function AnswerView({ id, ref, language, state, canUpload, onOpenSource, openPassage, onGotoUpload, onOpenEntity, openEntity, onReport, onRetry, retryDisabled }: Props) {
  const s = strings(language);
  const { answer } = state;
  const stepText: Record<RefusalStep, string> = {
    rephrase: s.refusalNextRephrase,
    askPerson: s.refusalNextAskPerson,
    upload: s.refusalNextUpload,
  };
  const still = useRef(settled.has(id)).current;
  useEffect(() => {
    if (answer !== undefined) settled.add(id);
  }, [id, answer]);
  // 串流中出現過的句子數：這些句子已經升起，回答完成時不再延遲
  const streamed = useRef(0);
  const sentences = answer === undefined ? streamingSentences(state.streaming) : answer.kind === "answer" ? answerSentences(answer.text) : null;
  if (answer === undefined) streamed.current = sentences!.length;
  const incomplete = answer?.kind === "answer" && answer.incomplete;
  const retryable = incomplete || (answer?.kind === "error" && !NOT_RETRYABLE.has(answer.error));
  const classes = ["card", "answer", still && "still", incomplete && "incomplete"].filter(Boolean).join(" ");
  const doneStep = sentences === null ? 0 : answerDoneStep(sentences.length, streamed.current);

  return (
    <section id={id} ref={ref} className={classes} style={{ "--done": doneStep } as CSSProperties} aria-live="polite">
      <h2>{state.question}</h2>
      {/* 串流中與完成後是同一個元素：已經升起的句子不重播 */}
      {sentences !== null && (
        <p className="answer-text">
          {sentences.map((sentence, i) => (
            <span key={i} className="sentence" style={{ "--i": sentenceStep(i, streamed.current) } as CSSProperties}>
              {sentence.map((segment, j) => {
                if ("text" in segment) return <Fragment key={j}>{segment.text}</Fragment>;
                const passage = (answer as Extract<Answer, { kind: "answer" }>).numbering[segment.citation - 1];
                return (
                  <button key={j} type="button" className="citation" title={s.openSource} aria-pressed={openPassage === passage} onClick={() => onOpenSource(passage)}>
                    {segment.citation}
                  </button>
                );
              })}
            </span>
          ))}
        </p>
      )}
      {answer === undefined && <p className="muted">{s.answering}</p>}
      {answer?.kind === "refusal" && (
        <div className="refusal">
          <p className="answer-text">{answer.text}</p>
          {/* 下一步只依上傳能力決定，「資料沒寫」與「沒有權限」相同（docs/qa.md「拒答」） */}
          <div className="refusal-next">
            <p className="muted">{s.refusalNextTitle}</p>
            <ul>
              {refusalNextSteps({ canUpload }).map((step, i) => (
                <li key={step} style={{ "--i": staggerIndex(i) } as CSSProperties}>
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
        </div>
      )}
      {answer?.kind === "error" && <p className="error">{errorMessage(language, answer.error)}</p>}
      {answer?.kind === "answer" && (
        <>
          {answer.uncited && <p className="badge warning">{s.uncited}</p>}
          {answer.incomplete && (
            <p className="badge warning">
              {s.incomplete}
              {answer.error !== undefined && `${s.colon}${errorMessage(language, answer.error)}`}
            </p>
          )}
          {state.mentions !== undefined && state.mentions.entities.length > 0 && (
            <Mentions language={language} {...state.mentions} onOpenEntity={onOpenEntity} openEntity={openEntity} />
          )}
        </>
      )}
      {retryable && (
        <p className="retry">
          <button type="button" className="secondary" disabled={retryDisabled} onClick={onRetry}>
            {s.answerRetry}
          </button>
        </p>
      )}
      {canReport(state) && <ReportForm language={language} initial={defaultCategory(state)} onReport={onReport} />}
    </section>
  );
}

// 「回報有錯」：按下後展開原因與選填說明；送出後只留下提示（同一題不再回報）
function ReportForm({ language, initial, onReport }: { language: string; initial: ReportCategory; onReport: Props["onReport"] }) {
  const s = strings(language);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(initial);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  if (status === "sent") return <p className="muted report-sent">{s.reportSent}</p>;
  if (!open)
    return (
      <p className="report-open">
        <button type="button" className="chip" onClick={() => setOpen(true)}>
          {s.reportButton}
        </button>
      </p>
    );
  return (
    <form
      className="report-form"
      aria-label={s.reportButton}
      onSubmit={(e) => {
        e.preventDefault();
        if (status === "sending") return;
        setStatus("sending");
        onReport(category, note).then(
          () => setStatus("sent"),
          () => setStatus("failed"),
        );
      }}
    >
      <label>
        {s.reportCategory}
        <select value={category} onChange={(e) => setCategory(e.target.value as ReportCategory)}>
          {REPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {s.reportCategories[c]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {s.reportNote}
        <textarea value={note} maxLength={MAX_REPORT_NOTE_CHARS} rows={2} onChange={(e) => setNote(e.target.value)} />
      </label>
      {status === "failed" && <p className="error">{s.reportFailed}</p>}
      <div className="dialog-actions">
        <button type="submit" disabled={status === "sending"}>
          {s.reportSubmit}
        </button>
        <button type="button" className="secondary" disabled={status === "sending"} onClick={() => setOpen(false)}>
          {s.reportCancel}
        </button>
      </div>
    </form>
  );
}

// 「回答提到」：依 knowledge-model.json 的類型順序分組；同名的實體加上第一個相關實體的名稱以便區分。
// 淺色外框的按鈕，名稱前是類型色點（裝飾，類型另有文字標籤）；目前在面板中的實體為選取狀態（#198）
function Mentions({
  language,
  graph,
  entities,
  onOpenEntity,
  openEntity,
}: {
  language: string;
  graph: Graph;
  entities: GraphEntity[];
  onOpenEntity: Props["onOpenEntity"];
  openEntity: OpenEntity | null;
}) {
  const s = strings(language);
  const types = [...new Set([...entityTypes.map((t) => t.id), ...entities.map((e) => e.type)])];
  // 類型標籤與按鈕依序出現（清單的 stagger）
  let order = 0;
  const next = () => ({ "--i": staggerIndex(order++) }) as CSSProperties;
  return (
    <div className="mentions" role="group" aria-label={s.answerMentions}>
      <p className="muted">{s.answerMentions}</p>
      {types.map((type) => {
        const ofType = entities.filter((e) => e.type === type);
        if (ofType.length === 0) return null;
        const color = entityTypes.find((t) => t.id === type)?.color;
        return (
          <div key={type} className="mention-group">
            <span className="badge" style={next()}>
              {entityTypeLabel(type, language)}
            </span>
            {ofType.map((e) => (
              <button
                key={e.id}
                type="button"
                className="chip"
                style={next()}
                aria-pressed={openEntity?.graph === graph && openEntity.id === e.id}
                onClick={() => onOpenEntity(graph, e.id)}
              >
                <span className="type-dot" style={{ "--type-color": color ?? "var(--color-graphFallback)" } as CSSProperties} aria-hidden="true" />
                {entityOptionLabel(graph, e, language)}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
