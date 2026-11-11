// 待審頁的「回報」分頁（ADR 0007 決定 7，docs/qa.md「回報有錯」）：目前身分看得到的回答錯誤回報，新的在前。
// 看得到哪些回報由 RLS 決定（有 canReview，且送給模型的段落全部看得到）；這裡只顯示 readReports() 的結果。
// 每則可以打開引用的原文與回答提到的實體（在圖譜面板撤回），並標示「不是錯誤」或「已撤回」。模型輸出一律以文字節點顯示
import { useRef, useState } from "react";
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import type { Database } from "../db/database";
import { ReviewError } from "../extraction/store";
import type { Graph } from "../graph/read";
import { splitCitations } from "../qa/citations";
import { resolveReport, type AnswerReport, type ReportResolution } from "../reports/store";
import { EmptyState } from "./EmptyState";
import { entityOptionLabel } from "./graph-labels";
import { Notice } from "./Notice";

interface Props {
  db: Database;
  identity: string;
  language: string;
  reports: AnswerReport[];
  // 目前身分看得到的圖譜（實體的名稱）
  graph: Graph;
  onOpenSource(passageId: string): void;
  // 切到圖譜頁並選取該實體（在右側面板撤回）
  onViewInGraph(entityId: string): void;
  // 處理後重新讀取
  onResolved(): void;
}

const roleLabel = (id: string, language: string) => clientConfig.access.roles.find((r) => r.id === id)?.label[language] ?? id;

export function ReportList({ db, identity, language, reports, graph, onOpenSource, onViewInGraph, onResolved }: Props) {
  const s = strings(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ reportId: string; text: string } | null>(null);
  // 連點時 state 還沒更新，以 ref 確保同時只有一個處理在進行
  const working = useRef(false);
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });

  async function resolve(reportId: string, resolution: ReportResolution) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await resolveReport(db, identity, reportId, resolution);
    } catch (e) {
      setError({ reportId, text: e instanceof ReviewError ? s.reviewErrors[e.reason] : s.unknownError });
    } finally {
      working.current = false;
      setBusy(false);
      onResolved();
    }
  }

  if (reports.length === 0) return <EmptyState icon="report" title={s.reportsEmpty} reason={s.reportsEmptyReason} />;
  return (
    <>
      {reports.map((r) => {
        const entities = r.entityIds.flatMap((id) => graph.entities.filter((e) => e.id === id));
        return (
          <section key={r.id} className="card report" aria-label={r.question}>
            {error?.reportId === r.id && (
              <Notice kind="error" title={s.noticeReviewTitle}>
                {error.text}
              </Notice>
            )}
            {/* 卡片（#245）：原因晶片 → 回報者與日期 → 問題 → 當時的回答 → 說明 → 回答提到 → 撤回提示與處理按鈕 */}
            <p className="report-chips">
              <span className="badge warning">{s.reportCategories[r.category]}</span>
              {r.resolution !== null && <span className="badge">{s.reportResolutions[r.resolution]}</span>}
            </p>
            <p className="muted">
              {fill(s.reportMeta, { name: roleLabel(r.reportedBy, language), date: dateFormat.format(new Date(r.reportedAt)) })}
            </p>
            <h2>{r.question}</h2>
            <div role="group" aria-label={s.reportAnswer} className={r.answer === null ? "report-answer refusal" : "report-answer"}>
              <p className="muted">{s.reportAnswer}</p>
              {r.answer === null ? (
                // 拒答：與問答相同的虛線框
                <p>{s.reportRefusal}</p>
              ) : (
                <p className="answer-text">
                  {/* 引用編號對應送出的段落（與問答相同的 numbering）；標號用證據色系（button.citation） */}
                  {splitCitations(r.answer).map((segment, i) => {
                    if ("text" in segment) return <span key={i}>{segment.text}</span>;
                    const id = r.sentPassageIds[segment.citation - 1];
                    if (id === undefined) return <span key={i}>[{segment.citation}]</span>;
                    return (
                      <button key={i} type="button" className="citation" title={s.openSource} onClick={() => onOpenSource(id)}>
                        {segment.citation}
                      </button>
                    );
                  })}
                </p>
              )}
            </div>
            {r.note !== null && <p className="report-note">{r.note}</p>}
            {entities.length > 0 && (
              <div className="mentions" role="group" aria-label={s.answerMentions}>
                <p className="muted">{s.answerMentions}</p>
                <div className="mention-group">
                  {entities.map((e) => (
                    <button key={e.id} type="button" className="chip" onClick={() => onViewInGraph(e.id)}>
                      {entityOptionLabel(graph, e, language)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {r.resolution === null && (
              <>
                {entities.length > 0 && <p className="muted">{s.reportRetractHint}</p>}
                <div className="dialog-actions">
                  <button type="button" className="secondary" disabled={busy} onClick={() => void resolve(r.id, "not_error")}>
                    {s.reportMarkNotError}
                  </button>
                  {r.answer !== null && (
                    <button type="button" className="secondary" disabled={busy} onClick={() => void resolve(r.id, "retracted")}>
                      {s.reportMarkRetracted}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}
