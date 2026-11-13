// 統一的提示框（#48）：錯誤、警告、資訊三種，包含圖示、標題、說明與可選的動作按鈕。
// 顯示在發生的位置，不另外彈出視窗。錯誤以 role="alert"、其他以 role="status" 讓螢幕閱讀器讀到。
import type { ReactNode } from "react";

export type NoticeKind = "error" | "warning" | "info";

interface Props {
  kind: NoticeKind;
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick(): void; disabled?: boolean };
  // 取代種類的預設圖示（例如額度用完的時鐘，#280）
  icon?: string;
  // 依位置調整樣式（例如桌機問答頁的額度說明條，#335）
  className?: string;
}

const ICONS: Record<NoticeKind, string> = { error: "!", warning: "⚠", info: "i" };

export function Notice({ kind, title, children, action, icon, className }: Props) {
  return (
    <div className={className === undefined ? `notice notice-${kind}` : `notice notice-${kind} ${className}`} role={kind === "error" ? "alert" : "status"}>
      <span className="notice-icon" aria-hidden="true">
        {icon ?? ICONS[kind]}
      </span>
      <div className="notice-body">
        <strong>{title}</strong>
        {children !== undefined && <div>{children}</div>}
        {action && (
          <button type="button" className="secondary" disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
