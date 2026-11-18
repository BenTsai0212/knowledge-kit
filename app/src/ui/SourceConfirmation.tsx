// 原文面板的來源確認（ADR 0013 決定 8、9，docs/design.md「來源確認」）：段落下方與「記錄」同一區（SeamRecords 的外觀：上方虛線、textMuted 小字）。
// 未確認：能確認的身分只在這次打開的出處段落（螢光標示）看到「確認這段」，其他段落與其他人什麼都看不到（由 SourceText 決定是否傳 onConfirm）。
// 已確認：「這段原文已確認 · 〈角色〉於〈日期〉確認」，只有角色與日期；失效（有不同說法、被新的說法取代）時改為失效的說明與打開另一段的連結；
// 能確認的身分另有「撤銷確認」。確認的是原文，不是 AI 的回答：不用 success 綠、不用勾勾，措辭一律是「這段原文已確認」
import { useEffect, useRef, useState } from "react";
import { fill, strings } from "../client/i18n";
import type { ConfirmationAction, PassageConfirmation } from "../sources/confirmations";
import { roleLabel } from "./ReportResult";

interface Props {
  language: string;
  // 目前已確認時才有（readSource() 經 RLS 讀出）
  confirmation: PassageConfirmation | undefined;
  // 能確認、撤銷確認時才有；寫入並重新讀取原文後 resolve
  onConfirm?(action: ConfirmationAction): Promise<void>;
  // 失效時打開另一段（說法不同的另一段，或取代這段的新段落）
  onOpenSource(passageId: string): void;
  // 撤銷後這段沒有「確認這段」（不是標示的段落）時，焦點交給外層
  onFocusLost?(): void;
}

export function SourceConfirmation({ language, confirmation, onConfirm, onOpenSource, onFocusLost }: Props) {
  const s = strings(language);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // 寫入成功後移動焦點：確認後到同一段的「撤銷確認」，撤銷後回到「確認這段」；等重新讀取的原文畫出新的狀態後才移動
  const [focusAfter, setFocusAfter] = useState<ConfirmationAction | null>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const confirmed = confirmation !== undefined;
  useEffect(() => {
    if (focusAfter === null || confirmed !== (focusAfter === "confirm")) return;
    setFocusAfter(null);
    if (actionButton.current !== null) actionButton.current.focus();
    else onFocusLost?.();
  }, [focusAfter, confirmed, onFocusLost]);
  if (confirmation === undefined && onConfirm === undefined) return null;

  const write = (action: ConfirmationAction) => {
    if (onConfirm === undefined || busy) return;
    setBusy(true);
    setFailed(false);
    onConfirm(action).then(
      () => (setBusy(false), setFocusAfter(action)),
      () => (setBusy(false), setFailed(true)),
    );
  };
  const action = (label: string, next: ConfirmationAction) =>
    onConfirm !== undefined && (
      <button ref={actionButton} type="button" className="link source-confirm__action" disabled={busy} onClick={() => write(next)}>
        {label}
      </button>
    );
  const error = failed && (
    <span className="source-confirm__error" role="alert">
      {s.sourceConfirmFailed}
    </span>
  );

  // 介面語言的文字；原文面板中外層是文件的語言
  if (confirmation === undefined)
    return (
      <p className="source-confirm" lang={language}>
        {action(s.sourceConfirm, "confirm")}
        {error}
      </p>
    );

  const { status } = confirmation;
  const date = new Intl.DateTimeFormat(language, { month: "numeric", day: "numeric" }).format(new Date(confirmation.confirmedAt));
  const label = status.kind === "valid" ? s.sourceConfirmed : status.kind === "superseded" ? s.sourceConfirmedSuperseded : s.sourceConfirmedDisputed;
  return (
    <div className={`seam-record source-confirmation source-confirmation--${status.kind}`} role="group" aria-label={s.sourceConfirmGroup} lang={language}>
      <p className="seam-record__row">
        <span>{label}</span>
        <span className="seam-record__who">{fill(s.sourceConfirmedBy, { role: roleLabel(confirmation.confirmedBy, language), date })}</span>
      </p>
      {(status.kind !== "valid" || onConfirm !== undefined || failed) && (
        <p className="seam-record__row source-confirm">
          {status.kind !== "valid" && (
            <button type="button" className="link source-confirm__open" onClick={() => onOpenSource(status.passageId)}>
              {status.kind === "superseded" ? s.sourceConfirmOpenNewer : s.sourceConfirmOpenOther}
            </button>
          )}
          {action(s.sourceConfirmRevoke, "revoke")}
          {error}
        </p>
      )}
    </div>
  );
}
