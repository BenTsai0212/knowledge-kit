// 平板的導覽列（#255，docs/design.md「平板」）：左側 72px，產品 icon、各頁籤（圖示＋11px 標籤，60×56px）、底部是身分的頭像。
// 依身分只列可用的頁籤，主管 7 個也放得下，所以沒有「更多」。頭像打開身分與語言面板（右側的滑出面板，內容與手機相同）。
// 「這次的問題」在平板上先不顯示（#255 決定 4）
import { useState } from "react";
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import { BottomSheet } from "./BottomSheet";
import { IDENTITY_SELECT_ID } from "./empty-state";
import { IdentitySheet } from "./IdentitySheet";
import { NavIcon } from "./MobileNav";
import { ProductIcon } from "./ProductIcon";
import { BRAND_ICON_SIZE, tabLabels, type NavProps } from "./Sidebar";

export function NavRail(props: NavProps) {
  const { language, identity, identityControl, views, view, onView, tabExtra } = props;
  const s = strings(language);
  const labels = tabLabels(language);
  const [open, setOpen] = useState(false);
  const signedIn = identityControl !== "none";
  const role = clientConfig.access.roles.find((r) => r.id === identity)?.label[language] ?? identity;

  return (
    <>
      <nav className="nav-rail" aria-label={s.views}>
        <h1 className="nav-rail__brand">
          <ProductIcon size={BRAND_ICON_SIZE} />
          <span className="visually-hidden">
            {s.productName} {clientConfig.client.displayName[language]}
          </span>
        </h1>
        {views.map((id) => (
          <button key={id} type="button" data-view={id} aria-current={view === id ? "page" : undefined} onClick={() => onView(id)}>
            <NavIcon view={id} />
            <span className="nav-rail__label">{labels[id]}</span>
            {tabExtra?.[id]}
          </button>
        ))}
        {signedIn && (
          // 頭像是角色名稱的第一個字；空狀態的「切換身分」把焦點移到這裡（#245）
          <button
            type="button"
            id={IDENTITY_SELECT_ID}
            className="identity-badge nav-rail__avatar"
            aria-haspopup="dialog"
            aria-label={fill(s.identityBadge, { role })}
            onClick={() => setOpen(true)}
          >
            <span aria-hidden="true">{Array.from(role)[0]}</span>
          </button>
        )}
      </nav>
      <BottomSheet open={open && signedIn} onClose={() => setOpen(false)} title={s.identityAndLanguage} language={language} className="identity-sheet" side="right">
        <IdentitySheet {...props} onChangeAccessCode={props.onChangeAccessCode && (() => (setOpen(false), props.onChangeAccessCode?.()))} />
      </BottomSheet>
    </>
  );
}
