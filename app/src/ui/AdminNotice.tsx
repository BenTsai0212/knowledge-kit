// 需要管理者的錯誤（#280，docs/design.md「錯誤與額度」）：對話區頂端的說明，原因一句，錯誤代碼與時間放在可展開的「給管理者的細節」。
// 輸入框保持可用；invalid_request、method_not_allowed 的下一步是重新整理頁面
import { errorMessage, strings } from "../client/i18n";
import { Notice } from "./Notice";
import { needsReload } from "./qa-errors";

interface Props {
  language: string;
  error: string;
  at: Date;
}

export function AdminNotice({ language, error, at }: Props) {
  const s = strings(language);
  return (
    <Notice
      kind="warning"
      title={s.qaProblems.adminTitle}
      action={needsReload(error) ? { label: s.qaProblems.reload, onClick: () => window.location.reload() } : undefined}
    >
      {errorMessage(language, error)}
      <details className="admin-details">
        <summary>{s.qaProblems.adminDetails}</summary>
        <code>
          {error} · {at.toISOString()}
        </code>
      </details>
    </Notice>
  );
}
