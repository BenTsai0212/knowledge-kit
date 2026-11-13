// 回報結果（#286，docs/design.md「日常工具」的「回報結果」）：回報的人在原本的回答下方與首頁「有更新」看到處理結果。
// 處理中、不是錯誤（日期＋說明＋「仍有疑問，再回報一次」）、已撤回相關內容（日期＋說明＋「再問一次」）；處理者只顯示角色。
// 說明是主管輸入的文字，一律以文字節點顯示
import { useEffect, useState } from "react";
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import type { AnswerReport } from "../reports/store";
import { reportState } from "./report-helpers";

// 身分 id 對應的角色名稱（角色層級的身分，畫面只顯示角色）
export const roleLabel = (id: string, language: string) => clientConfig.access.roles.find((r) => r.id === id)?.label[language] ?? id;

interface Props {
  language: string;
  report: AnswerReport;
  // 不是錯誤的「仍有疑問，再回報一次」：展開回報表單
  onReportAgain(): void;
  // 已撤回的「再問一次」：用現在看得到的資料重新回答
  onAskAgain(): void;
  askDisabled: boolean;
}

export function ReportResult({ language, report, onReportAgain, onAskAgain, askDisabled }: Props) {
  const s = strings(language).reportResult;
  const state = reportState(report);
  if (state === "pending")
    return (
      <div className="report-result report-result--pending" role="status">
        <p className="muted">{s.pending}</p>
      </div>
    );
  const date = new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(report.resolvedAt!));
  return (
    // 狀態的 class：桌機回答卡片中左邊線與底色依狀態（#335，畫板 K-Answer）
    <div className={`report-result report-result--${state}`} role="status">
      <p className="report-result__head">
        <span className="badge">{state === "not_error" ? s.notError : s.retracted}</span>
        <span className="muted">{fill(s.meta, { role: roleLabel(report.resolvedBy!, language), date })}</span>
      </p>
      {report.resolutionNote !== null && (
        <>
          <p className="muted">{s.noteLabel}</p>
          <p className="report-note">{report.resolutionNote}</p>
        </>
      )}
      <p className="report-result__actions">
        {state === "not_error" ? (
          <button type="button" className="secondary" onClick={onReportAgain}>
            {s.reportAgain}
          </button>
        ) : (
          <button type="button" className="secondary" disabled={askDisabled} onClick={onAskAgain}>
            {s.askAgain}
          </button>
        )}
      </p>
    </div>
  );
}

// 回答下方：讀取這一題送出的回報（每次掛載時重新讀取，所以回到問答頁就是最新的狀態）。
// 讀取中與讀不到（例如之後送出的段落有一段看不到）時只留下「已送出回報」
export function ReportStatus({ language, reportId, read, ...actions }: Omit<Props, "report"> & { reportId: string; read(reportId: string): Promise<AnswerReport | null> }) {
  const [report, setReport] = useState<AnswerReport | null>(null);
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    read(reportId).then(
      (r) => !cancelled && setReport(r),
      () => !cancelled && setReport(null),
    );
    return () => {
      cancelled = true;
    };
    // read 每次 render 都是新的函式；回報 id 相同時不重新讀取
  }, [reportId]);
  if (report === null) return <p className="muted report-sent">{strings(language).reportSent}</p>;
  return <ReportResult language={language} report={report} {...actions} />;
}
