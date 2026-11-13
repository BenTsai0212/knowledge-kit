// 手機的導覽（#255，docs/design.md「手機的共同結構」）：頂端列（產品 icon、客戶名稱、身分徽章；下方一行「虛構資料」「展示用權限」）、
// 底部分頁列（首頁、問答、圖譜、時間軸或上傳、更多；分配見 layout.ts 的 phoneTabs()）。只有兩個頁籤時（展示模式的登入頁）改用頂端列下方的分段切換；
// 展示模式登入後不渲染本元件，改用 PresentationBar（#260）。
// 身分徽章打開身分與語言面板，「更多」打開列出其餘頁面的面板，兩者都是底部面板。「這次的問題」在問答頁頂部（SessionQuestions，#256 決定 1）
import { useState } from "react";
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import { BottomSheet } from "./BottomSheet";
import { IDENTITY_SELECT_ID } from "./empty-state";
import { IdentitySheet } from "./IdentitySheet";
import { NAV_ICONS, phoneTabs, usesSegmented } from "./layout";
import type { View } from "./online-demo";
import { ProductIcon } from "./ProductIcon";
import { tabLabels, type NavProps } from "./Sidebar";

// 頂端列的 icon：28px（簡化版）
const TOPBAR_ICON_SIZE = 28;

export function NavIcon({ view }: { view: View | "more" }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={NAV_ICONS[view]} />
    </svg>
  );
}

export function MobileNav(props: NavProps) {
  const { language, identity, identityControl, views, view, onView, tabExtra } = props;
  const s = strings(language);
  const labels = tabLabels(language);
  const [sheet, setSheet] = useState<"identity" | "more" | null>(null);
  const { tabs, more } = phoneTabs(views);
  const signedIn = identityControl !== "none";
  const role = clientConfig.access.roles.find((r) => r.id === identity)?.label[language] ?? identity;

  const tabButton = (id: View) => (
    <button key={id} type="button" data-view={id} aria-current={view === id ? "page" : undefined} onClick={() => onView(id)}>
      <NavIcon view={id} />
      <span className="mobile-tabbar__label">{labels[id]}</span>
      {tabExtra?.[id]}
    </button>
  );

  return (
    <>
      <header className="mobile-topbar">
        <div className="mobile-topbar__row">
          <h1 className="mobile-brand">
            <ProductIcon size={TOPBAR_ICON_SIZE} />
            <span className="visually-hidden">{s.productName} </span>
            <span className="mobile-brand__client">{clientConfig.client.displayName[language]}</span>
          </h1>
          {signedIn && (
            // 空狀態的「切換身分」把焦點移到這裡（#245）
            <button
              type="button"
              id={IDENTITY_SELECT_ID}
              className="identity-badge"
              aria-haspopup="dialog"
              aria-label={fill(s.identityBadge, { role })}
              onClick={() => setSheet("identity")}
            >
              {role}
            </button>
          )}
        </div>
        <p className="mobile-topbar__badges">
          <span className="badge">{s.fictionalData}</span>
          {signedIn && <span className="badge">{s.demoPermissions}</span>}
        </p>
      </header>
      {usesSegmented(views) ? (
        <nav className="mobile-segmented" aria-label={s.views}>
          {tabs.map((id) => (
            <button key={id} type="button" data-view={id} aria-current={view === id ? "page" : undefined} onClick={() => onView(id)}>
              {labels[id]}
            </button>
          ))}
        </nav>
      ) : (
        <nav className="mobile-tabbar" aria-label={s.views}>
          {tabs.map(tabButton)}
          {more.length > 0 && (
            <button type="button" data-view="more" aria-haspopup="dialog" aria-current={more.includes(view) ? "page" : undefined} onClick={() => setSheet("more")}>
              <NavIcon view="more" />
              <span className="mobile-tabbar__label">{s.navMore}</span>
              {more.map((id) => tabExtra?.[id]).find((extra) => extra)}
            </button>
          )}
        </nav>
      )}
      <BottomSheet open={sheet === "identity" && signedIn} onClose={() => setSheet(null)} title={s.identityAndLanguage} language={language} className="identity-sheet">
        <IdentitySheet
          {...props}
          onChangeAccessCode={props.onChangeAccessCode && (() => (setSheet(null), props.onChangeAccessCode?.()))}
        />
      </BottomSheet>
      {more.length > 0 && (
        <BottomSheet open={sheet === "more"} onClose={() => setSheet(null)} title={s.navMore} language={language} className="more-sheet">
          <ul className="more-list">
            {more.map((id) => (
              <li key={id}>
                <button type="button" data-view={id} aria-current={view === id ? "page" : undefined} onClick={() => (setSheet(null), onView(id))}>
                  <NavIcon view={id} />
                  <span>{labels[id]}</span>
                  {tabExtra?.[id]}
                </button>
              </li>
            ))}
          </ul>
        </BottomSheet>
      )}
    </>
  );
}
