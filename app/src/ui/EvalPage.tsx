// 評測台（#62，docs/evals.md「畫面」）：兩組檢索設定、預計呼叫次數的確認、進度與停止、總覽、每題的結果與兩組差異、下載 JSON 與品質報告（#210）。
// 只有 canReview 的身分看得到（App 決定）。評測使用專用的記憶體資料庫，評測結束、停止或離開頁籤時關閉。
import { useEffect, useRef, useState } from "react";
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
import { createEvalDatabases, differs, effectiveForm, evalReport, parseReportSource, parseSettings, settingsForm, setSummary, TOP_K_MAX, verdicts, type SettingsForm } from "./eval-helpers";
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

  function metricCell(summary: Summary, key: (typeof METRICS)[number]) {
    const m: Metric = summary[key];
    const value = key === "leakage" ? fill(s.evalLeakCount, { count: m.passed }) : m.rate === null ? s.evalNotApplicable : fill(s.evalRate, { passed: m.passed, total: m.total, percent: percent(m.rate) });
    const status = m.meets === null ? (summary.complete ? s.evalNotApplicable : s.evalIncomplete) : m.meets ? s.evalPass : s.evalFail;
    return (
      <>
        {value} <span className={`badge${m.meets === false ? " warning" : ""}`}>{status}</span>
        {key === "answer" && summary.answer.ungradable > 0 && <div className="muted">{fill(s.evalUngradable, { count: summary.answer.ungradable })}</div>}
      </>
    );
  }

  function resultCell(q: EvalQuestion, r: QuestionResult | undefined, run: EvalRun) {
    const { mode } = run;
    if (!applies(q, run.providerId)) return <span className="muted">{s.evalRequiresSemantic}</span>;
    if (r === undefined) return <span className="muted">{s.evalNotRun}</span>;
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
          <details>
            <summary>{s.evalAnswerText}</summary>
            <p className="answer-text">{answer.text}</p>
          </details>
        )}
        {score.citation !== null && answer.kind === "answer" && (
          <p>
            {s.evalCitations}
            {s.colon}
            {score.citation.cited.length === 0 ? s.evalNoCitations : score.citation.cited.map((c) => `${c.inAnswer ? "✓" : "✗"} ${c.id}`).join(s.listSeparator)}
            {score.citation.dropped.length > 0 && <span className="error"> {fill(s.evalDropped, { numbers: score.citation.dropped.join(s.listSeparator) })}</span>}
          </p>
        )}
        {score.keyPoints !== null && q.keyPoints.length > 0 && (
          <p>
            {s.evalKeyPoints}
            {s.colon}
            {score.keyPoints.points.map((p) => (p.matched !== null ? `✓ ${p.matched}` : `✗ ${p.synonyms.join(" / ")}`)).join(s.listSeparator)}
          </p>
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
      <section className="card eval-settings">
        <h2>{s.evalSettings}</h2>
        {forms.map((f, i) =>
          i === 1 && !useB ? null : (
            <fieldset key={i} disabled={busy}>
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
          ),
        )}
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
        {run?.status === "running" && (
          <p aria-live="polite">
            {s.evalRunning} {fill(s.evalProgress, { done: Math.min(done + 1, applicable.length * run.sets.length), total: applicable.length * run.sets.length })}
          </p>
        )}
        {run?.status === "done" && <p className="muted">{s.evalDone}</p>}
        {run?.status === "done" && phase !== "running" && (
          <fieldset>
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
        <>
          <section className="card">
            <h2>{s.evalSummary}</h2>
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
                    <td>{key === "leakage" ? fill(s.evalAtMost, { count: LEAKAGE_LIMIT }) : fill(s.evalAtLeast, { percent: percent(thresholds[key]) })}</td>
                    {summaries.map((summary, i) => (
                      <td key={i}>{metricCell(summary, key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>{s.evalResults}</h2>
            {twoSets && (
              <label className="inline">
                <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
                {s.evalOnlyDiff}
              </label>
            )}
            <table className="eval-table">
              <thead>
                <tr>
                  <th>{s.evalQuestion}</th>
                  {run.sets.map((_, i) => (
                    <th key={i}>{fill(s.evalSetName, { name: SET_NAMES[i] })}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <strong>{q.question}</strong>
                      <div className="muted">
                        {[
                          access.roles.find((r) => r.id === q.role)?.label[language] ?? q.role,
                          q.language,
                          ...(q.passageLanguage === undefined ? [] : [fill(s.evalPassageLanguage, { language: q.passageLanguage })]),
                          s.evalCategories[q.category],
                          s.evalExpect[q.expect],
                        ].join(s.listSeparator)}
                      </div>
                      {twoSets && differs(byId[0].get(q.id), byId[1].get(q.id), run.mode) && <span className="badge warning">{s.evalDiffers}</span>}
                    </td>
                    {byId.map((results, i) => (
                      <td key={i}>{resultCell(q, results.get(q.id), run)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
