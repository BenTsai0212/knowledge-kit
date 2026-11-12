// 登入頁的面板（#287，docs/design.md「日常工具」的「登入」）：帳號登入（主要，展示）與下方的「使用邀請碼體驗」。
// 帳號登入只是展示：帳號欄列出各角色的展示帳號，密碼欄停用；不用 <form>、欄位沒有 name，帳號與密碼不送出、不保存，瀏覽器不會當成登入表單。
// 展示模式（?mode=presentation）只顯示邀請碼（#287 決定 2）。fork 時把帳號登入換成客戶的身分驗證（docs/client-config.md「登入（展示）」）
import { useId, useState, type KeyboardEvent } from "react";
import { clientConfig } from "../client/load";
import { errorMessage, fill, strings } from "../client/i18n";
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
  // 帳號欄預設選的角色（登入頁左側導覽目前的身分）
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
  const ids = { noPassword: useId(), error: useId() };
  const needsCode = needsAccessCode(onlineDemo.publicAccessCode);
  const accessCode = accountAccessCode(onlineDemo.publicAccessCode, code);
  const invalid = rejected?.via === "account";

  if (withCode) {
    return (
      <>
        <AccessCodeForm language={language} rejected={rejected?.via === "code" ? rejected.code : null} onSubmit={onCode} />
        {offersAccountSignIn(presentation) && (
          <button type="button" className="link" onClick={() => setWithCode(false)}>
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
    <>
      <section className="card access-code sign-in" aria-label={s.signInTitle} onKeyDown={onKeyDown}>
        <h2>{s.signInTitle}</h2>
        <label>
          {s.signInAccount}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {clientConfig.access.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {fill(s.signInAccountOption, { account: demoAccount(r.id), role: r.label[language] })}
              </option>
            ))}
          </select>
        </label>
        <label>
          {s.signInPassword}
          <input type="password" disabled autoComplete="off" aria-describedby={ids.noPassword} />
        </label>
        <p id={ids.noPassword} className="muted">
          {s.signInNoPassword}
        </p>
        {/* 沒有公開碼的部署：/api/ask 仍以邀請碼把關，帳號登入也要輸入 */}
        {needsCode && (
          <label>
            {s.accessCodeLabel}
            <input
              type="password"
              autoComplete="off"
              value={code}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? ids.error : undefined}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        )}
        {invalid && (
          <div className="access-code__error">
            <p id={ids.error} className="error">
              {errorMessage(language, "invalid_access_code")}
            </p>
          </div>
        )}
        <button type="button" disabled={accessCode === null} onClick={submit}>
          {s.signInSubmit}
        </button>
      </section>
      <button type="button" className="secondary" onClick={() => setWithCode(true)}>
        {s.signInWithCode}
      </button>
    </>
  );
}
