import { Fragment, useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { clientConfig } from "../client/load";
import type { Graph, GraphEntity } from "../graph/read";
import type { Answer } from "../qa/answer";
import { errorMessage, fill, strings } from "../client/i18n";
import { entityOptionLabel, entityTypeLabel } from "./graph-labels";
import { MAX_REPORT_NOTE_CHARS, REPORT_CATEGORIES, type AnswerReport, type ReportCategory } from "../reports/store";
import { refusalNextSteps, type RefusalStep, type RefusalSuggestion } from "./refusal-next-steps";
import { canReport, defaultCategory } from "./report-helpers";
import { answerDoneStep, answerSentences, sentenceStep, streamingSentences } from "./answer-motion";
import { staggerIndex } from "./motion";
import { errorCategory } from "./qa-errors";
import { ReportStatus } from "./ReportResult";

export interface AnswerState {
  question: string;
  // 串流中到目前為止的文字
  streaming: string;
  // 結束後的結果
  answer?: Answer;
  // 回答提到的實體（#195）：以送出當下的身分讀出的圖譜，與從中挑出的實體（mentions.ts）。
  // 拒答時 entities 是空的，圖譜用來產生「可以試試」（#285）
  mentions?: { graph: Graph; entities: GraphEntity[] };
  // 這一題送出的回報（#286）：回答下方顯示處理結果；再回報一次時換成新的回報
  reportId?: string;
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
  // 沒有時不顯示「回報有錯」與回報結果（展示模式，#260）
  onReport?(category: ReportCategory, note: string): Promise<void>;
  // 回答下方的回報結果（#286）：以目前身分讀取這一題送出的回報；讀不到時為 null
  readReport(reportId: string): Promise<AnswerReport | null>;
  // 回答中斷或失敗時的「重新提問」：以同一個問題再問一次（新的一題）；回答中不能按
  onRetry(): void;
  retryDisabled: boolean;
  // prompt_too_long 的「縮短問題」：問題填回輸入框（#280）
  onShorten(): void;
  // 拒答的「換個問法」（#285）：問句填進輸入框，不送出
  onDraft(question: string): void;
  // 拒答的「在圖譜看它」（#285）：切到圖譜頁並選取該實體
  onViewInGraph(entityId: string): void;
  // 手機原文面板的「回報有錯」（#256）：每按一次加一，打開這一題的回報表單並捲到該題；0 是沒有要求
  reportRequest?: number;
  // 標題：預設是問題；身分對照的欄是該欄的身分（#261，問題在各欄上方只顯示一次）
  heading?: string;
}

const { entityTypes } = clientConfig.knowledgeModel;

// 回答完成後已播過動態的題目：切換頁籤回來重新掛載時不再播放（#227）
const settled = new Set<string>();

export function AnswerView({ id, ref, language, state, canUpload, onOpenSource, openPassage, onGotoUpload, onOpenEntity, openEntity, onReport, readReport, onRetry, retryDisabled, onShorten, onDraft, onViewInGraph, reportRequest = 0, heading }: Props) {
  const s = strings(language);
  const { answer } = state;
  const stepText: Record<RefusalStep, string> = {
    rephrase: s.refusalNextRephrase,
    askPerson: s.refusalNextAskPerson,
    upload: s.refusalNextUpload,
  };
  const graph = state.mentions?.graph;
  const name = (entity: GraphEntity) => entityOptionLabel(graph!, entity, language);
  // 「可以試試」的一項：實體的名稱一律來自送出當下身分的圖譜（RLS 已篩選）
  const suggestion = (x: RefusalSuggestion) => {
    switch (x.kind) {
      case "step":
        return (
          <>
            {stepText[x.step]}
            {x.step === "upload" && (
              <>
                {" "}
                <button type="button" onClick={onGotoUpload}>
                  {s.refusalGotoUpload}
                </button>
              </>
            )}
          </>
        );
      case "graph":
        return (
          <>
            {fill(s.refusalNextGraph, { name: name(x.entity) })}{" "}
            <button type="button" className="link" onClick={() => onViewInGraph(x.entity.id)}>
              {s.viewInGraph}
            </button>
          </>
        );
      case "owner":
        return fill(s.refusalNextOwner, { owner: name(x.owner), name: name(x.entity), role: x.role });
      case "rephrase":
        if (x.question === null) return fill(s.refusalNextRephraseName, { name: name(x.entity) });
        return (
          <>
            {fill(s.refusalNextRephraseWith, { name: name(x.entity) })}{" "}
            <button type="button" className="chip" onClick={() => onDraft(x.question!)}>
              {x.question}
            </button>
          </>
        );
    }
  };
  const suggestionKey = (x: RefusalSuggestion) => (x.kind === "step" ? x.step : `${x.kind}:${x.entity.id}`);
  const still = useRef(settled.has(id)).current;
  useEffect(() => {
    if (answer !== undefined) settled.add(id);
  }, [id, answer]);
  // 串流中出現過的句子數：這些句子已經升起，回答完成時不再延遲
  const streamed = useRef(0);
  const sentences = answer === undefined ? streamingSentences(state.streaming) : answer.kind === "answer" ? answerSentences(answer.text) : null;
  if (answer === undefined) streamed.current = sentences!.length;
  const incomplete = answer?.kind === "answer" && answer.incomplete;
  // 錯誤依「使用者可以做什麼」分類（#280）：只有暫時的問題能重新提問；問題要改、模型無法回答重新送出結果相同
  const category = answer?.kind === "error" ? errorCategory(answer.error) : null;
  const retryable = incomplete || category === "transient";
  // 模型無法回答（upstream_refusal）比照拒答：虛線框與「可以試試」
  const refusalText = answer?.kind === "refusal" ? answer.text : answer?.kind === "error" && category === "modelRefusal" ? errorMessage(language, answer.error) : null;
  const classes = ["card", "answer", still && "still", incomplete && "incomplete"].filter(Boolean).join(" ");
  const doneStep = sentences === null ? 0 : answerDoneStep(sentences.length, streamed.current);
  // 「仍有疑問，再回報一次」：送出後換成新回報的結果
  const [again, setAgain] = useState(false);
  // 從原文面板要求回報：展開回報表單（已回報過時是「再回報一次」），焦點移到原因、捲到表單（表單在這一題的最後）
  const focusReport = useRef(false);
  useEffect(() => {
    if (reportRequest === 0) return;
    focusReport.current = true;
    setAgain(true);
  }, [reportRequest]);
  useEffect(() => {
    if (!again || !focusReport.current) return;
    focusReport.current = false;
    const form = document.getElementById(id)?.querySelector<HTMLElement>(".report-form");
    form?.querySelector("select")?.focus({ preventScroll: true });
    // 不可寫成 () => …scrollIntoView()（見 Conversation）
    void form?.scrollIntoView({ block: "nearest" });
  }, [again, reportRequest]);

  return (
    <section id={id} ref={ref} className={classes} style={{ "--done": doneStep } as CSSProperties} aria-live="polite">
      <h2>{heading ?? state.question}</h2>
      {/* 回答本體：桌機是問題泡泡下方的回答卡片（#335，畫板 QA）；其他版面沒有自己的樣式，與直接放在 section 中相同 */}
      <div className="answer__body">
        {/* 依據：引用到的段落數，與原文欄「這次回答的出處」、手機「出處 N／M」的 M 相同（#322）；只在桌機顯示 */}
        {answer?.kind === "answer" && answer.cited.length > 0 && (
          <p className="answer-basis">{fill(s.answerBasis, { count: new Set(answer.cited).size }, language)}</p>
        )}
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
        {refusalText !== null && (
          <div className="refusal">
            <p className="answer-text">{refusalText}</p>
            {/* 下一步只依問題、上傳能力與看得到的圖譜決定，「資料沒寫」與「沒有權限」相同（docs/qa.md「拒答」、#285）；模型無法回答比照拒答（#280） */}
            <div className="refusal-next">
              <p className="muted">{s.refusalNextTitle}</p>
              <ul>
                {refusalNextSteps({ canUpload, graph, question: state.question, language }).map((x, i) => (
                  <li key={suggestionKey(x)} style={{ "--i": staggerIndex(i) } as CSSProperties}>
                    {suggestion(x)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {/* 錯誤是中性的卡片，不用 danger（#280）；prompt_too_long 沒有送出，下一步是縮短問題 */}
        {answer?.kind === "error" && category !== "modelRefusal" && (
          <div className="problem" role="status">
            <p>{errorMessage(language, answer.error)}</p>
            {answer.error === "prompt_too_long" && (
              <p className="problem-actions">
                <span className="badge">{s.qaProblems.notSent}</span>
                <button type="button" className="secondary" onClick={onShorten}>
                  {s.qaProblems.shorten}
                </button>
              </p>
            )}
          </div>
        )}
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
        {onReport !== undefined &&
          canReport(state) &&
          (state.reportId === undefined || again ? (
            <ReportForm
              // 從原文面板要求回報時重建成展開的表單（again 只在建立時讀取）
              key={again ? "again" : "idle"}
              language={language}
              initial={defaultCategory(state)}
              open={again}
              onReport={(category, note) => onReport(category, note).then(() => setAgain(false))}
              onCancel={again ? () => setAgain(false) : undefined}
            />
          ) : (
            <ReportStatus
              language={language}
              reportId={state.reportId}
              read={readReport}
              onReportAgain={() => setAgain(true)}
              onAskAgain={onRetry}
              askDisabled={retryDisabled}
            />
          ))}
      </div>
    </section>
  );
}

// 「回報有錯」：按下後展開原因與選填說明；送出後只留下提示（回答下方改顯示回報結果，#286）。
// open：一開始就展開（再回報一次）；onCancel：取消時改由呼叫端處理（回到回報結果）
export function ReportForm({ language, initial, onReport, open: initialOpen = false, onCancel }: { language: string; initial: ReportCategory; onReport: NonNullable<Props["onReport"]>; open?: boolean; onCancel?(): void }) {
  const s = strings(language);
  const [open, setOpen] = useState(initialOpen);
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
        <button type="button" className="secondary" disabled={status === "sending"} onClick={() => (onCancel ?? (() => setOpen(false)))()}>
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
