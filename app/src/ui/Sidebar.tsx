import type { ReactNode } from "react";
import { clientConfig } from "../client/load";
import { strings } from "../client/i18n";
import { IDENTITY_SELECT_ID } from "./empty-state";
import type { View } from "./online-demo";
import { IdentityControls } from "./IdentityControls";
import { ProductIcon } from "./ProductIcon";
import type { IdentityControl } from "./sign-in";

// 頁首 icon 的尺寸：大於 32px，用完整版（含主色節點）
export const BRAND_ICON_SIZE = 36;

// 導覽共用的內容：桌機的左側導覽與手機的頂端列＋分頁列（#255）都用這一份
export interface NavProps {
  language: string;
  identity: string;
  // 身分欄（#287）：登入頁不顯示（none）、以邀請碼體驗或展示模式進入後是選單（menu）、帳號登入時顯示帳號與角色（account）
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
  // 問答頁的「這次的問題」：點了捲到該題
  questions: readonly { id: string; question: string }[];
  onQuestion(id: string): void;
}

// 導覽的頁籤：上傳頁的「已送審」標記以此找到「待審」的位置（#242 PR 3）；手機的分頁列也適用，主管的「待審」收在「更多」（#255）
export const tabSelector = (view: View | "more") => `:is(.primary-tabs, .mobile-tabbar, .nav-rail) [data-view="${view}"]`;

// 頁籤的名稱（左側導覽、手機的分頁列與「更多」共用）
export function tabLabels(language: string): Record<View, string> {
  const s = strings(language);
  return { home: s.tabHome, qa: s.tabQa, graph: s.tabGraph, timeline: s.tabTimeline, upload: s.tabUpload, review: s.tabReview, evals: s.tabEvals };
}

// 左側導覽（#195）：公司名稱、身分、語言、更換邀請碼（帳號登入時是登出）、頁籤，問答頁另列「這次的問題」
export function Sidebar({ language, identity, identityControl, account, onIdentity, onLanguage, onChangeAccessCode, views, view, onView, tabExtra, questions, onQuestion }: NavProps) {
  const s = strings(language);
  const labels = tabLabels(language);
  return (
    <div className="sidebar">
      <header className="toolbar">
        {/* 組合字標（#226）：側欄固定兩行，第一行 icon＋產品名稱，第二行客戶名稱（不加分隔線） */}
        <h1 className="brand">
          <span className="brand__product">
            <ProductIcon size={BRAND_ICON_SIZE} />
            <span className="brand__wordmark">{s.productName}</span>
          </span>{" "}
          <span className="brand__client">{clientConfig.client.displayName[language]}</span>
        </h1>
        <span className="badge">{s.fictionalData}</span>
        <IdentityControls
          language={language}
          identity={identity}
          identityControl={identityControl}
          account={account}
          onIdentity={onIdentity}
          onLanguage={onLanguage}
          onChangeAccessCode={onChangeAccessCode}
          selectId={IDENTITY_SELECT_ID}
        />
      </header>
      <nav className="primary-tabs" aria-label={s.views}>
        {views.map((id) => (
          <button key={id} type="button" data-view={id} aria-current={view === id ? "page" : undefined} onClick={() => onView(id)}>
            {labels[id]}
            {tabExtra?.[id]}
          </button>
        ))}
      </nav>
      {/* 連結而不是按鈕：與預設問題的按鈕同名時不會混淆 */}
      {view === "qa" && questions.length > 0 && (
        <nav className="session-questions" aria-label={s.sessionQuestions}>
          <h2>{s.sessionQuestions}</h2>
          <ol>
            {questions.map((q) => (
              <li key={q.id}>
                <a
                  href={`#${q.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onQuestion(q.id);
                  }}
                >
                  {q.question}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </div>
  );
}
