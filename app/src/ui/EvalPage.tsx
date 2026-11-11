// 評測台（#62，docs/evals.md「畫面」）：兩組檢索設定、預計呼叫次數的確認、進度與停止、總覽、每題的結果與兩組差異、下載 JSON 與品質報告（#210）。
// 只有 canReview 的身分看得到（App 決定）。評測使用專用的記憶體資料庫，評測結束、停止或離開頁籤時關閉。
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { errorMessage, fill, strings, taskErrorMessage } from "../client/i18n";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import { evalQuestions, evalQuestionsSource } from "../evals/load";
import { qualityReport, questionBank, type ReportSource } from "../evals/report";
import { reportHtml } from "../evals/report-html";
import { applies, applicableQuestions, estimateCalls, openEvalDatabase, runEvals, type EvalContext, type EvalRun, type EvalSettings, type QuestionResult } from "../evals/run";
import { LEAKAGE_LIMIT, type AnswerMode, type Metric, type Summary } from "../evals/score";
import type { EvalQuestion } from "../evals/types";
import { apiTransport } from "../qa/api";
import { preparesModel, type ActiveProvider } from "../retrieval/providers";
import { openRetriever } from "../retrieval/retrieve";
import { answerSentences } from "./answer-motion";
import { bankSummary, createEvalDatabases, differs, effectiveForm, evalReport, outcome, parseReportSource, parseSettings, progressCells, settingsForm, setSummary, TOP_K_MAX, verdicts, type Outcome, type SettingsForm } from "./eval-helpers";
import { EmptyState } from "./EmptyState";
import { FilePicker } from "./FilePicker";
import { Notice } from "./Notice";
import { RetrievalNotice } from "./RetrievalNotice";
import type { ProviderStatus } from "./retrieval-notice";

const { client, access } = clientConfig;
const questions = evalQuestions.questions;
// 題庫版本（下載 JSON 用）；載入時算一次
const bank = questionBank(evalQuestionsSource, questions.length);
const { thresholds } = client.evals;
const METRICS = ["citation", "answer", "leakage", "refusal"] as const;
const SET_NAMES = ["A", "B"];
const BANK = bankSummary(questions);
// 展開單題時顯示引用的段落（評測用的是資料集，不含上傳的文件）
const PASSAGES = new Map(Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => [p.id, p.text] as const)));
// 每題的結果以符號＋文字區分，不只靠顏色
const OUTCOME_SYMBOL: Record<Outcome, string> = { correct: "✓", refused: "✓", incorrect: "✗" };

// 預設值先取自 client.json 的 retrieval，provider 準備好後換成實際生效的參數（降級時不同，#178）；只在這次評測有效
const DEFAULT_FORM = settingsForm(client.retrieval);

interface Props {
  language: string;
  accessCode: string;
  // 本次工作階段上傳的文件數（不納入評測，只提示）
  uploadedCount: number;
  // App 共用的 VectorProvider 與準備狀態；準備中顯示下載進度，降級時評測的是 keyword-hash，以提示標明
  provider: Promise<ActiveProvider>;
  status: ProviderStatus;
  // 結果由 App 保存，切換頁籤後仍可查看與下載
  run: EvalRun | null;
  onRun(run: EvalRun): void;
  onRejectAccessCode(): void;
}

type Phase = "idle" | "estimating" | "confirm" | "running";

const percent = (rate: number) => Math.round(rate * 1000) / 10;

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function EvalPage({ language, accessCode, uploadedCount, provider, status, run, onRun, onRejectAccessCode }: Props) {
  const s = strings(language);
  const [forms, setForms] = useState<SettingsForm[]>([DEFAULT_FORM, DEFAULT_FORM]);
  const [useB, setUseB] = useState(false);
  const [model, setModel] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [estimate, setEstimate] = useState({ ask: 0, grade: 0, total: 0 });
  const [failed, setFailed] = useState(false);
  const [onlyDiff, setOnlyDiff] = useState(false);
  // 展開的題目 id
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // 進入頁籤時已有的結果不重播動態（進度格與指標彈出），之後開始的評測才播
  const [stillRun] = useState(run?.startedAt);
  // 品質報告：要報告的設定組與另一次的下載 JSON（選填，顯示穩定性）
  const [reportSet, setReportSet] = useState(0);
  const [previous, setPrevious] = useState<ReportSource | null>(null);
  const [previousInvalid, setPreviousInvalid] = useState(false);
  const [previousName, setPreviousName] = useState<string | null>(null);
  const dbs = useRef(createEvalDatabases(() => openEvalDatabase(clientConfig, dataset)));
  const ctx = useRef<EvalContext | null>(null);
  // 確認視窗估算時的設定；開始後以同一組執行
  const planned = useRef<{ sets: EvalSettings[]; mode: AnswerMode } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  // 離開頁籤（包括切換到沒有 canReview 的身分）：停止評測並關閉資料庫
  useEffect(() => {
    const databases = dbs.current;
    return () => {
      controller.current?.abort();
      void databases.close();
    };
  }, []);

  // provider 準備好後，人還沒改過的欄位換成實際生效的檢索參數
  useEffect(() => {
    let live = true;
    provider.then(
      ({ options }) => live && setForms((all) => all.map((f) => effectiveForm(f, options))),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [provider]);

  useEffect(() => {
    const d = dialog.current;
    if (d === null) return;
    if (phase === "confirm" && !d.open) d.showModal();
    if (phase !== "confirm" && d.open) d.close();
  }, [phase]);

  const parsed = forms.slice(0, useB ? 2 : 1).map((f) => parseSettings(f.topK, f.minScore));
  const plan = parsed.every((x) => x !== null) ? { sets: parsed as EvalSettings[], mode: model ? ("model" as const) : ("keyPoints" as const) } : null;
  const busy = phase !== "idle";

  // 先開資料庫、以每組設定跑一次檢索算出預計次數，經確認才開始
  async function prepare() {
    if (plan === null) return;
    setFailed(false);
    setPhase("estimating");
    try {
      const db = await dbs.current.open();
      // 降級時是 keyword-hash：requires: "semantic" 的題目不適用
      const { provider: active, options } = await provider;
      // provider 準備好之前按下開始時，表單可能還是 client.json 的值：以實際生效的參數估算與執行
      const sets = forms.slice(0, plan.sets.length).map((f) => effectiveForm(f, options)).map((f) => parseSettings(f.topK, f.minScore));
      if (!sets.every((x) => x !== null)) throw new Error("invalid settings");
      planned.current = { sets: sets as EvalSettings[], mode: plan.mode };
      ctx.current = { retriever: openRetriever(db, client.retrieval, provider), transport: apiTransport({ accessCode }), config: clientConfig, data: dataset, questions, providerId: active.id };
      setEstimate(await estimateCalls(ctx.current, planned.current.sets, planned.current.mode));
      setPhase("confirm");
    } catch {
      await cancel();
      setFailed(true);
    }
  }

  async function cancel() {
    ctx.current = null;
    planned.current = null;
    setPhase("idle");
    await dbs.current.close();
  }

  async function start() {
    if (ctx.current === null || planned.current === null) return;
    const abort = (controller.current = new AbortController());
    setPhase("running");
    try {
      const final = await runEvals(ctx.current, planned.current, onRun, abort.signal);
      if (final.stopReason === "invalid_access_code") onRejectAccessCode();
    } catch {
      // 離開頁籤時資料庫已關閉，進行中的檢索會失敗；已完成的結果已經透過 onRun 保存
    } finally {
      controller.current = null;
      await cancel();
    }
  }

  const stamp = (run: EvalRun) => run.startedAt.replace(/[:.]/g, "-");
  const report = async (run: EvalRun) => evalReport(run, questions, thresholds, { model: client.model, questionBank: await bank });

  async function download() {
    if (run === null) return;
    save(new Blob([JSON.stringify(await report(run), null, 2)], { type: "application/json" }), `evals-${stamp(run)}.json`);
  }

  // 品質報告（docs/evals.md「品質報告」）：只在評測完成後
  async function downloadReport() {
    if (run === null) return;
    const current = await report(run);
    const set = Math.min(reportSet, current.sets.length - 1);
    const html = reportHtml(qualityReport({ questions, access, data: dataset, thresholds, current, set, previous }), access, language);
    save(new Blob([html], { type: "text/html" }), `quality-report-${stamp(run)}.html`);
  }

  async function choosePrevious(file: File | undefined) {
    const parsed = file === undefined ? null : parseReportSource(await file.text());
    setPrevious(parsed);
    setPreviousName(file?.name ?? null);
    setPreviousInvalid(file !== undefined && parsed === null);
  }

  const setForm = (i: number, field: "topK" | "minScore", value: string) =>
    setForms((all) => all.map((f, j) => (j === i ? { ...f, [field]: value, edited: { ...f.edited, [field]: true } } : f)));
  const done = run?.sets.reduce((n, set) => n + set.results.length, 0) ?? 0;
  const applicable = run === null ? questions : applicableQuestions(questions, run.providerId);
  const summaries = run?.sets.map((set) => setSummary(applicable, set, thresholds, run.mode)) ?? [];
  const twoSets = run !== null && run.sets.length === 2;
  const byId = run?.sets.map((set) => new Map(set.results.map((r) => [r.question, r]))) ?? [];
  const rows = questions.filter((q) => !onlyDiff || !twoSets || differs(byId[0].get(q.id), byId[1].get(q.id), run?.mode ?? "keyPoints"));
  const index = new Map(questions.map((q, i) => [q.id, i + 1]));
  const animate = run !== null && run.startedAt !== stillRun;
  const cells = run === null ? [] : progressCells(run, applicable);
  const outcomeText: Record<Outcome, string> = { correct: s.evalOutcomeCorrect, incorrect: s.evalOutcomeIncorrect, refused: s.evalOutcomeRefused };
  const toggle = (id: string) =>
    setExpanded((all) => {
      const next = new Set(all);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // 四項指標的徽章：通過 success 淡底、未通過 warning 淡底（不用紅色）；--i 是評測完成時依序彈出的順序
  function metricCell(summary: Summary, key: (typeof METRICS)[number]) {
    const m: Metric = summary[key];
    const value = key === "leakage" ? fill(s.evalLeakCount, { count: m.passed }) : m.rate === null ? s.evalNotApplicable : fill(s.evalRate, { passed: m.passed, total: m.total, percent: percent(m.rate) });
    const status = m.meets === null ? (summary.complete ? s.evalNotApplicable : s.evalIncomplete) : m.meets ? s.evalPass : s.evalFail;
    const tone = m.meets === null ? "" : m.meets ? " pass" : " fail";
    return (
      <>
        {value}{" "}
        <span className={`badge eval-verdict${tone}`} style={{ "--i": METRICS.indexOf(key) } as CSSProperties}>
          {status}
        </span>
        {key === "answer" && summary.answer.ungradable > 0 && <div className="muted">{fill(s.evalUngradable, { count: summary.answer.ungradable })}</div>}
      </>
    );
  }

  function resultCell(q: EvalQuestion, r: QuestionResult | undefined, run: EvalRun) {
    if (!applies(q, run.providerId)) return <span className="muted">{s.evalRequiresSemantic}</span>;
    if (r === undefined) return <span className="muted">{s.evalNotRun}</span>;
    const o = outcome(q, r, run.mode);
    return (
      <span className={`eval-outcome ${o}`}>
        <span aria-hidden="true">{OUTCOME_SYMBOL[o]}</span> {outcomeText[o]}
      </span>
    );
  }

  // 展開單題：各指標、回答（引用標號用證據色系）、關鍵重點、引用的段落、模型評分與滲漏
  function resultDetail(q: EvalQuestion, r: QuestionResult | undefined, run: EvalRun) {
    const { mode } = run;
    if (!applies(q, run.providerId)) return <p className="muted">{s.evalRequiresSemantic}</p>;
    if (r === undefined) return <p className="muted">{s.evalNotRun}</p>;
    const v = verdicts(r, mode);
    const badges: [string, boolean][] = [
      ...(v.citation === null ? [] : [[s.evalMetrics.citation, v.citation] as [string, boolean]]),
      ...(v.answer === null ? [] : [[s.evalMetrics.answer, v.answer] as [string, boolean]]),
      ...(v.refusal === null ? [] : [[s.evalMetrics.refusal, v.refusal] as [string, boolean]]),
      [s.evalMetrics.leakage, !v.leaked],
    ];
    const { answer, score } = r;
    return (
      <div className="eval-result">
        <div>
          {badges.map(([label, pass]) => (
            <span key={label} className={`badge${pass ? "" : " warning"}`}>
              {fill(s.parenthetical, { text: label, note: pass ? s.evalPass : s.evalFail })}
            </span>
          ))}
        </div>
        {answer.kind === "error" ? (
          <p className="error">{errorMessage(language, answer.error)}</p>
        ) : (
          <div role="group" aria-label={s.evalAnswerText} className={answer.kind === "refusal" ? "eval-answer refusal" : "eval-answer"}>
            <p className="muted">{s.evalAnswerText}</p>
            <p className="eval-answer-text" lang={q.language}>
              {answer.kind === "refusal"
                ? answer.text
                : answerSentences(answer.text)
                    .flat()
                    .map((segment, i) =>
                      "text" in segment ? (
                        <Fragment key={i}>{segment.text}</Fragment>
                      ) : (
                        <span key={i} className="citation">
                          {segment.citation}
                        </span>
                      ),
                    )}
            </p>
          </div>
        )}
        {score.keyPoints !== null && q.keyPoints.length > 0 && (
          <p>
            {s.evalKeyPoints}
            {s.colon}
            {score.keyPoints.points.map((p) => (p.matched !== null ? `✓ ${p.matched}` : `✗ ${p.synonyms.join(" / ")}`)).join(s.listSeparator)}
          </p>
        )}
        {score.citation !== null && answer.kind === "answer" && (
          <div>
            <p>
              {s.evalCitedPassages}
              {s.colon}
              {score.citation.cited.length === 0 && s.evalNoCitations}
              {score.citation.dropped.length > 0 && <span className="error"> {fill(s.evalDropped, { numbers: score.citation.dropped.join(s.listSeparator) })}</span>}
            </p>
            {score.citation.cited.length > 0 && (
              <ul className="eval-passages">
                {score.citation.cited.map((c) => (
                  <li key={c.id}>
                    <span className="citation">{answer.numbering.indexOf(c.id) + 1}</span> <code>{c.id}</code> {c.inAnswer ? "✓" : "✗"}
                    {PASSAGES.has(c.id) && <p className="eval-passage">{PASSAGES.get(c.id)}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {r.grade !== undefined && (
          <p>
            {s.evalGrade}
            {s.colon}
            {s.evalVerdicts[r.grade.verdict]}
            {r.grade.reason !== null && ` — ${r.grade.reason}`}
            {r.gradeError !== undefined && <span className="error"> {taskErrorMessage(language, r.gradeError)}</span>}
          </p>
        )}
        {score.leaks.map((leak, i) => (
          <p key={i} className="error">
            {fill(s.evalLeaks[leak.kind], { id: "passage" in leak ? leak.passage : "document" in leak ? leak.document : "", term: "term" in leak ? leak.term : "" })}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="eval-page">
      <header className="eval-header">
        <h2>{s.tabEvals}</h2>
        <p className="muted">{fill(s.evalBankSummary, BANK)}</p>
      </header>

      {/* 上半部（#244）：「評測設定」與「總覽」兩張卡片並排，窄螢幕上下堆疊 */}
      <div className="eval-overview">
        <section className="card eval-settings">
          <h3>{s.evalSettings}</h3>
          <div className="eval-sets">
            {forms.map((f, i) => (
              <fieldset key={i} disabled={busy || (i === 1 && !useB)}>
                <legend>{fill(s.evalSetName, { name: SET_NAMES[i] })}</legend>
                <label>
                  {s.evalTopK}
                  <input type="number" min={1} max={TOP_K_MAX} step={1} value={f.topK} onChange={(e) => setForm(i, "topK", e.target.value)} />
                </label>
                <label>
                  {s.evalMinScore}
                  <input type="number" min={0} max={1} step={0.05} value={f.minScore} onChange={(e) => setForm(i, "minScore", e.target.value)} />
                </label>
              </fieldset>
            ))}
          </div>
          <label className="inline">
            <input type="checkbox" checked={useB} disabled={busy} onChange={(e) => setUseB(e.target.checked)} />
            {s.evalUseSetB}
          </label>
          <label className="inline">
            <input type="checkbox" checked={model} disabled={busy} onChange={(e) => setModel(e.target.checked)} />
            {s.evalModelGrading}
          </label>
          {plan === null && <p className="error">{s.evalInvalidSettings}</p>}
          <RetrievalNotice language={language} preparesModel={preparesModel(client.retrieval)} status={status} />
          {uploadedCount > 0 && <Notice kind="info" title={fill(s.evalUploaded, { count: uploadedCount })} />}
          {failed && <p className="error">{s.loadFailed}</p>}
          <div className="dialog-actions">
            {phase === "running" ? (
              <button type="button" className="secondary" onClick={() => controller.current?.abort()}>
                {s.evalStop}
              </button>
            ) : (
              <button type="button" disabled={busy || plan === null} onClick={() => void prepare()}>
                {phase === "estimating" ? s.evalPreparing : s.evalStart}
              </button>
            )}
            {run !== null && phase !== "running" && (
              <button type="button" className="secondary" onClick={download}>
                {s.evalDownload}
              </button>
            )}
          </div>
          {run?.status === "done" && <p className="muted">{s.evalDone}</p>}
          {run?.status === "done" && phase !== "running" && (
            <fieldset className="eval-report">
              <legend>{s.evalReport.title}</legend>
              {run.sets.length === 2 && (
                <label>
                  {s.evalReport.set}
                  <select value={reportSet} onChange={(e) => setReportSet(Number(e.target.value))}>
                    {run.sets.map((set, i) => (
                      <option key={i} value={i}>
                        {fill(s.parenthetical, { text: fill(s.evalSetName, { name: SET_NAMES[i] }), note: fill(s.evalSettingsValue, set.settings) })}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <FilePicker
                label={s.evalReport.previous}
                accept=".json,application/json"
                onChange={(e) => void choosePrevious(e.target.files?.[0])}
                button={s.fileChoose}
                status={previousName ?? <span className="muted">{s.fileNone}</span>}
              />
              {previousInvalid && <p className="error">{s.evalReport.previousInvalid}</p>}
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={() => void downloadReport()}>
                  {s.evalReport.download}
                </button>
              </div>
            </fieldset>
          )}
          {run?.status === "stopped" && (
            <Notice kind="warning" title={s.evalStopped}>
              {run.stopReason === "aborted" ? s.evalAborted : errorMessage(language, run.stopReason ?? "")}
            </Notice>
          )}
        </section>

        {/* 尚未執行（#245）：下一步與設定區的「開始評測」相同（文字不同，避免同名的兩個按鈕） */}
        {run === null ? (
          <EmptyState
            icon="evals"
            title={s.evalEmptyTitle}
            reason={s.evalEmptyReason}
            actions={[{ label: s.evalEmptyAction, onClick: () => void prepare(), disabled: busy || plan === null }]}
          />
        ) : (
          <section className={["card", "eval-summary", !animate && "still", animate && run.status === "done" && "settled"].filter(Boolean).join(" ")}>
            <h3>{s.evalSummary}</h3>
            {run.status === "running" && (
              <p aria-live="polite">
                {s.evalRunning} {fill(s.evalProgress, { done: Math.min(done + 1, cells.length), total: cells.length })}
              </p>
            )}
            {/* 評測中（progress）：每題結果回來就填一格；真實題數在上一行，格子只是輔助 */}
            <ol className="eval-progress" aria-hidden="true">
              {cells.map((cell, i) => (
                <li key={i}>{cell !== null && <span className={`eval-cell ${cell === "incorrect" ? "fail" : "pass"}`} />}</li>
              ))}
            </ol>
            <div className="table-scroll">
              <table className="eval-table">
                <thead>
                  <tr>
                    <th>{s.evalMetric}</th>
                    <th>{s.evalThreshold}</th>
                    {run.sets.map((set, i) => (
                      <th key={i}>
                        {fill(s.evalSetName, { name: SET_NAMES[i] })}
                        <div className="muted">{fill(s.evalSettingsValue, set.settings)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((key) => (
                    <tr key={key}>
                      <th scope="row">{s.evalMetrics[key]}</th>
                      <td className="eval-threshold">{key === "leakage" ? fill(s.evalAtMost, { count: LEAKAGE_LIMIT }) : fill(s.evalAtLeast, { percent: percent(thresholds[key]) })}</td>
                      {summaries.map((summary, i) => (
                        <td key={i}>{metricCell(summary, key)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <dialog ref={dialog} className="upload-dialog" aria-label={s.evalConfirmTitle} onClose={() => phase === "confirm" && void cancel()}>
        <h2>{s.evalConfirmTitle}</h2>
        <p>{fill(s.evalConfirmCalls, estimate)}</p>
        <p className="muted">{s.evalConfirmLimit}</p>
        <div className="dialog-actions">
          <button type="button" onClick={() => void start()}>
            {s.evalConfirmStart}
          </button>
          <button type="button" className="secondary" onClick={() => void cancel()}>
            {s.evalCancel}
          </button>
        </div>
      </dialog>

      {run !== null && (
        <section className="card">
          <h3>{s.evalResults}</h3>
          {twoSets && (
            <label className="inline">
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
              {s.evalOnlyDiff}
            </label>
          )}
          {/* 寬表格放在可橫向捲動的容器；可聚焦，讓鍵盤也能捲動 */}
          <div className="table-scroll" role="region" aria-label={s.evalResults} tabIndex={0}>
            <table className="eval-table eval-results">
              <thead>
                <tr>
                  <th>{s.evalNumber}</th>
                  <th>{s.evalQuestion}</th>
                  <th>{s.evalCategory}</th>
                  <th>{s.evalRole}</th>
                  {run.sets.map((_, i) => (
                    <th key={i}>{fill(s.evalSetName, { name: SET_NAMES[i] })}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => {
                  const open = expanded.has(q.id);
                  const detail = `eval-detail-${q.id}`;
                  return (
                    <Fragment key={q.id}>
                      <tr>
                        <td className="eval-number">{index.get(q.id)}</td>
                        <td>
                          <button type="button" className="link eval-question" aria-expanded={open} aria-controls={open ? detail : undefined} onClick={() => toggle(q.id)}>
                            {q.question}
                          </button>
                          <div className="muted">
                            {[
                              q.language,
                              ...(q.passageLanguage === undefined ? [] : [fill(s.evalPassageLanguage, { language: q.passageLanguage })]),
                              s.evalExpect[q.expect],
                            ].join(s.listSeparator)}
                          </div>
                          {twoSets && differs(byId[0].get(q.id), byId[1].get(q.id), run.mode) && <span className="badge warning">{s.evalDiffers}</span>}
                        </td>
                        <td>
                          <span className="eval-chip">{s.evalCategories[q.category]}</span>
                        </td>
                        <td>{access.roles.find((r) => r.id === q.role)?.label[language] ?? q.role}</td>
                        {byId.map((results, i) => (
                          <td key={i}>{resultCell(q, results.get(q.id), run)}</td>
                        ))}
                      </tr>
                      {open && (
                        <tr id={detail} className="eval-detail">
                          <td colSpan={4 + run.sets.length}>
                            <div className="eval-detail-sets">
                              {byId.map((results, i) => (
                                <div key={i} role="group" aria-label={fill(s.evalSetName, { name: SET_NAMES[i] })}>
                                  {twoSets && <h4>{fill(s.evalSetName, { name: SET_NAMES[i] })}</h4>}
                                  {resultDetail(q, results.get(q.id), run)}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
