import type { ReactNode } from "react";
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import { IDENTITY_SELECT_ID } from "./empty-state";
import type { View } from "./online-demo";
import { ProductIcon } from "./ProductIcon";

// 頁首 icon 的尺寸：大於 32px，用完整版（含主色節點）
export const BRAND_ICON_SIZE = 36;

interface Props {
  language: string;
  identity: string;
  // 帳號登入時的展示帳號（#287）：身分固定，顯示帳號與角色、不顯示選單，「更換邀請碼」改為「登出」；以邀請碼體驗時為 undefined
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

// 導覽的頁籤：上傳頁的「已送審」標記以此找到「待審」的位置（#242 PR 3）
export const tabSelector = (view: View) => `.primary-tabs [data-view="${view}"]`;

// 語言以該語言自己的名稱顯示（例如 zh-TW → 中文（台灣））
const ownName = (code: string) => new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;

// 左側導覽（#195）：公司名稱、身分、語言、更換邀請碼（帳號登入時是登出）、頁籤，問答頁另列「這次的問題」
export function Sidebar({ language, identity, account, onIdentity, onLanguage, onChangeAccessCode, views, view, onView, tabExtra, questions, onQuestion }: Props) {
  const s = strings(language);
  const tabLabels: Record<View, string> = {
    qa: s.tabQa,
    graph: s.tabGraph,
    timeline: s.tabTimeline,
    upload: s.tabUpload,
    review: s.tabReview,
    evals: s.tabEvals,
  };
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
        {account === undefined ? (
          <label>
            {s.identity}
            {/* 空狀態的「切換身分」把焦點移到這裡（#245） */}
            <select id={IDENTITY_SELECT_ID} value={identity} onChange={(e) => onIdentity(e.target.value)}>
              {clientConfig.access.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label[language]}
                </option>
              ))}
            </select>
            <span className="badge">{s.demoPermissions}</span>
          </label>
        ) : (
          // 帳號登入：身分是登入的帳號，不能切換（docs/design.md「身分是登入的人，不是設定」）
          <p className="identity-account">
            {s.identity}
            <span>
              {fill(s.signInAccountOption, {
                account,
                role: clientConfig.access.roles.find((r) => r.id === identity)?.label[language] ?? identity,
              })}
            </span>
            <span className="badge">{s.demoPermissions}</span>
          </p>
        )}
        <label>
          {s.language}
          <select value={language} onChange={(e) => onLanguage(e.target.value)}>
            {clientConfig.client.languages.map((code) => (
              <option key={code} value={code}>
                {ownName(code)}
              </option>
            ))}
          </select>
        </label>
        {onChangeAccessCode && (
          <button type="button" className="link" onClick={onChangeAccessCode}>
            {account === undefined ? s.changeAccessCode : s.signOut}
          </button>
        )}
      </header>
      <nav className="primary-tabs" aria-label={s.views}>
        {views.map((id) => (
          <button key={id} type="button" data-view={id} aria-current={view === id ? "page" : undefined} onClick={() => onView(id)}>
            {tabLabels[id]}
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
