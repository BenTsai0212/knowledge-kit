// 桌機（≥ 1025px）的左側欄（#330，畫板 docs/design/v1/boards/K-Home.dc.html 的 <nav>）：220px、surface 底、右邊 1px border。
// 由上而下是 K 晶格 icon＋客戶名稱、頁面項目（44px，選中是 text 底、surface 字；待審的筆數是右側的 primary 圓形徽章）、
// 底部的「虛構資料 · 展示用權限」虛線框與使用者卡。使用者卡按下打開左側欄旁的身分與語言選單（內容與手機的面板相同，#330 決定 1、2）；
// 帳號登入時卡上另有「登出」，選單只有語言與「登出」。登入頁沒有使用者卡，語言是虛線框上方的下拉選單。
// 「這次的問題」不放在左側欄（#330 決定 3）
import { useState, type ReactNode } from "react";
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import { BottomSheet } from "./BottomSheet";
import { IDENTITY_SELECT_ID } from "./empty-state";
import { IdentitySheet, ownName } from "./IdentitySheet";
import type { View } from "./online-demo";
import { ProductIcon } from "./ProductIcon";
import type { IdentityControl } from "./sign-in";

// 平板導覽列與展示模式頂端列的 icon 尺寸：大於 32px，用完整版（含主色節點）
export const BRAND_ICON_SIZE = 36;
// 左側欄頂部的 icon：28px（畫板的尺寸；32px 以下是簡化版，與手機的頂端列相同）
export const SIDEBAR_ICON_SIZE = 28;

// 導覽共用的內容：桌機的左側欄、平板的導覽列與手機的頂端列＋分頁列（#255）都用這一份
export interface NavProps {
  language: string;
  identity: string;
  // 身分欄（#287）：登入頁不顯示（none）、以邀請碼體驗或展示模式進入後可以切換（menu）、帳號登入時顯示帳號與角色（account）
  identityControl: IdentityControl;
  // 帳號登入時的展示帳號（#287）：身分固定，「更換邀請碼」改為「登出」；以邀請碼體驗時為 undefined
  account?: string;
  onIdentity(identity: string): void;
  onLanguage(language: string): void;
  onChangeAccessCode?(): void;
  views: readonly View[];
  view: View;
  onView(view: View): void;
  // 頁籤名稱後面附加的內容（待審頁籤的筆數）
  tabExtra?: Partial<Record<View, ReactNode>>;
}

// 導覽的頁籤：上傳頁的「已送審」標記以此找到「待審」的位置（#242 PR 3）；手機的分頁列也適用，主管的「待審」收在「更多」（#255）
export const tabSelector = (view: View | "more") => `:is(.primary-tabs, .mobile-tabbar, .nav-rail) [data-view="${view}"]`;

// 頁籤的名稱（左側欄、手機的分頁列與「更多」共用）
export function tabLabels(language: string): Record<View, string> {
  const s = strings(language);
  return { home: s.tabHome, qa: s.tabQa, graph: s.tabGraph, timeline: s.tabTimeline, upload: s.tabUpload, review: s.tabReview, evals: s.tabEvals };
}

// 使用者卡的縮寫頭像：帳號登入時是帳號的第一個字（大寫），以邀請碼體驗時是角色名稱的第一個字（與平板的頭像相同）
export const avatarInitial = (name: string) => (Array.from(name)[0] ?? "").toLocaleUpperCase();

export function Sidebar(props: NavProps) {
  const { language, identity, identityControl, account, onLanguage, onChangeAccessCode, views, view, onView, tabExtra } = props;
  const s = strings(language);
  const labels = tabLabels(language);
  const [open, setOpen] = useState(false);
  const signedIn = identityControl !== "none";
  const role = clientConfig.access.roles.find((r) => r.id === identity);
  const roleName = role?.label[language] ?? identity;
  const name = account ?? roleName;
  const closeThen = (action?: () => void) => action && (() => (setOpen(false), action()));

  return (
    // 整個左側欄是頁首（banner）：客戶名稱、頁面與身分都在這裡
    <header className="sidebar">
      <h1 className="sidebar__brand">
        <ProductIcon size={SIDEBAR_ICON_SIZE} />
        <span className="visually-hidden">{s.productName} </span>
        <span className="sidebar__client">{clientConfig.client.displayName[language]}</span>
      </h1>
      <nav className="primary-tabs" aria-label={s.views}>
        {views.map((v) => (
          <button key={v} type="button" data-view={v} aria-current={view === v ? "page" : undefined} onClick={() => onView(v)}>
            <span className="primary-tabs__label">{labels[v]}</span>
            {tabExtra?.[v]}
          </button>
        ))}
      </nav>
      <div className="sidebar__footer">
        {!signedIn && (
          <label className="sidebar__language">
            {s.language}
            <select value={language} onChange={(e) => onLanguage(e.target.value)}>
              {clientConfig.client.languages.map((code) => (
                <option key={code} value={code}>
                  {ownName(code)}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="sidebar__labels">
          <span>{s.fictionalData}</span>
          {signedIn && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{s.demoPermissions}</span>
            </>
          )}
        </p>
        {signedIn && (
          <div className="user-card">
            {/* 空狀態的「切換身分」把焦點移到這裡（#245）；名稱是卡上看得到的文字 */}
            <button type="button" id={IDENTITY_SELECT_ID} className="identity-badge user-card__button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
              <span className="user-card__who">
                <span className="user-card__avatar" aria-hidden="true">
                  {avatarInitial(name)}
                </span>
                <span className="user-card__names">
                  <b className="user-card__name">{name}</b>
                  {account !== undefined && <span className="user-card__role">{roleName}</span>}
                </span>
              </span>
              {role !== undefined && (
                <span className="user-card__scope">
                  {fill(s.userCardScope, { scope: role.scope[language] })}
                </span>
              )}
            </button>
            {account !== undefined && onChangeAccessCode && (
              <button type="button" className="link user-card__sign-out" onClick={onChangeAccessCode}>
                {s.signOut}
              </button>
            )}
          </div>
        )}
      </div>
      {/* 登入頁沒有選單（語言是上方的下拉選單） */}
      {signedIn && (
        <BottomSheet open={open} onClose={() => setOpen(false)} title={s.identityAndLanguage} language={language} className="identity-sheet" side="popover">
          <IdentitySheet {...props} hideAccount onChangeAccessCode={closeThen(onChangeAccessCode)} />
        </BottomSheet>
      )}
    </header>
  );
}
