// 共用的空狀態元件（#245，docs/design.md「狀態的共同語言」）：虛線框、線條圖示、粗體標題、一句原因、最多兩個下一步
import { EMPTY_ICONS, emptyActions, type EmptyAction, type EmptyIconName } from "./empty-state";

interface Props {
  icon: EmptyIconName;
  title: string;
  reason?: string;
  // 第一個是主要按鈕，第二個是次要按鈕；超過兩個時捨去
  actions?: readonly EmptyAction[];
  // 外層元素：頁面中的區塊用 section，面板內（例如找路徑）用 div
  as?: "section" | "div";
}

export function EmptyState({ icon, title, reason, actions = [], as: Tag = "section" }: Props) {
  const shown = emptyActions(actions);
  return (
    <Tag className="empty-state">
      <svg className="empty-state__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={EMPTY_ICONS[icon]} />
      </svg>
      <p className="empty-state__title">{title}</p>
      {reason !== undefined && <p className="empty-state__reason">{reason}</p>}
      {shown.length > 0 && (
        <div className="empty-state__actions">
          {shown.map((a, i) => (
            <button key={a.label} type="button" className={i === 0 ? undefined : "secondary"} disabled={a.disabled} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </Tag>
  );
}
