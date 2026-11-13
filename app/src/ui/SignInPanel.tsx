// 登入頁的面板（#287，docs/design.md「日常工具」的「登入」）：帳號登入（主要，展示）與「使用邀請碼體驗」，在同一個面板內切換（#334，畫板 K-Login）。
// 帳號登入只是展示：帳號是各角色展示帳號的單選卡，密碼欄停用；不用 <form>，帳號與密碼不送出、不保存，瀏覽器不會當成登入表單
// （單選鈕的 name 只用來把同一組歸在一起，讓方向鍵能在卡片間移動）。
// 展示模式（?mode=presentation）只顯示邀請碼（#287 決定 2）。fork 時把帳號登入換成客戶的身分驗證（docs/client-config.md「登入（展示）」）
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { clientConfig } from "../client/load";
import { errorMessage, strings } from "../client/i18n";
import { AccessCodeForm } from "./AccessCodeForm";
import { onlineDemo } from "./online-demo";
import { accountAccessCode, demoAccount, needsAccessCode, offersAccountSignIn } from "./sign-in";

// 被拒的邀請碼（invalid_access_code）與當時用的登入方式：回到同一條路並顯示原因（#246）
export interface Rejected {
  code: string;
  via: "account" | "code";
}

interface Props {
  language: string;
  // 帳號欄預設選的角色（目前的身分）
  identity: string;
  rejected: Rejected | null;
  presentation: boolean;
  onAccount(role: string, accessCode: string): void;
  onCode(accessCode: string): void;
}

export function SignInPanel({ language, identity, rejected, presentation, onAccount, onCode }: Props) {
  const s = strings(language);
  const [withCode, setWithCode] = useState(!offersAccountSignIn(presentation) || rejected?.via === "code");
  const [role, setRole] = useState(identity);
  const [code, setCode] = useState(rejected?.via === "account" ? rejected.code : "");
  const ids = { title: useId(), account: useId(), group: useId(), hint: useId(), error: useId() };
  const needsCode = needsAccessCode(onlineDemo.publicAccessCode);
  const accessCode = accountAccessCode(onlineDemo.publicAccessCode, code);
  const invalid = rejected?.via === "account";

  // 「使用邀請碼體驗」與「改用帳號登入」切換後，焦點移到新的標題（第一次顯示時不搶焦點）
  const title = useRef<HTMLHeadingElement>(null);
  const switched = useRef(false);
  useEffect(() => {
    if (switched.current) title.current?.focus();
  }, [withCode]);
  const switchTo = (next: boolean) => {
    switched.current = true;
    setWithCode(next);
  };

  if (withCode) {
    return (
      <>
        <AccessCodeForm language={language} rejected={rejected?.via === "code" ? rejected.code : null} onSubmit={onCode} titleRef={title} />
        {offersAccountSignIn(presentation) && (
          <button type="button" className="link sign-in__back" onClick={() => switchTo(false)}>
            <span aria-hidden="true">← </span>
            {s.signInBack}
          </button>
        )}
      </>
    );
  }

  const submit = () => accessCode !== null && onAccount(role, accessCode);
  // 不用 <form>：Enter 鍵在欄位中直接登入
  const onKeyDown = (e: KeyboardEvent) => e.key === "Enter" && e.target instanceof HTMLInputElement && submit();
  return (
    <section className="card access-code sign-in" aria-labelledby={ids.title} onKeyDown={onKeyDown}>
      <p className="entry-eyebrow" aria-hidden="true">
        {s.signInEyebrow}
      </p>
      <h2 id={ids.title} ref={title} tabIndex={-1}>
        {s.signInTitle}
      </h2>
      {/* 帳號：各角色的展示帳號（access.json 的順序），原生單選鈕，Tab 進入、方向鍵切換 */}
      <span id={ids.account} className="sign-in__label">
        {s.signInAccount}
      </span>
      <div className="account-cards" role="radiogroup" aria-labelledby={ids.account}>
        {clientConfig.access.roles.map((r) => (
          <label key={r.id} className="account-card">
            <input type="radio" name={ids.group} value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} />
            <span className="account-card__text">
              <span className="account-card__account">{demoAccount(r.id)}</span>
              <span className="account-card__role">{r.label[language]}</span>
            </span>
          </label>
        ))}
      </div>
      <label>
        {s.signInPassword}
        <input type="password" className="sign-in__password" disabled autoComplete="off" placeholder={s.signInNoPassword} aria-describedby={ids.hint} />
      </label>
      {/* 沒有公開碼的部署：/api/ask 仍以邀請碼把關，帳號登入也要輸入（#287）；放在密碼欄下方 */}
      {needsCode && (
        <label>
          {s.accessCodeLabel}
          <input
            type="password"
            className="entry-code"
            autoComplete="off"
            value={code}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? ids.error : undefined}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
      )}
      <p id={ids.hint} className="muted">
        {s.signInAccountHint}
      </p>
      {invalid && (
        <div className="access-code__error">
          <p id={ids.error} className="error">
            {errorMessage(language, "invalid_access_code")}
          </p>
        </div>
      )}
      <button type="button" className="entry-primary" disabled={accessCode === null} onClick={submit}>
        {s.signInSubmit}
      </button>
      <p className="sign-in__or" aria-hidden="true">
        {s.signInOr}
      </p>
      <button type="button" className="secondary sign-in__alt" onClick={() => switchTo(true)}>
        {s.signInWithCode}
      </button>
    </section>
  );
}
