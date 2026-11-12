// 身分、語言與更換邀請碼（帳號登入時是登出）：桌機左側導覽的頁首與手機的身分與語言面板共用（#255 從 Sidebar.tsx 移出）
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import type { IdentityControl } from "./sign-in";

interface Props {
  language: string;
  identity: string;
  identityControl: IdentityControl;
  account?: string;
  onIdentity(identity: string): void;
  onLanguage(language: string): void;
  onChangeAccessCode?(): void;
  // 空狀態的「切換身分」把焦點移到有這個 id 的元件（#245）；手機上是頂端列的身分徽章，面板裡的選單不帶 id
  selectId?: string;
}

// 語言以該語言自己的名稱顯示（例如 zh-TW → 中文（台灣））
const ownName = (code: string) => new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;

export function IdentityControls({ language, identity, identityControl, account, onIdentity, onLanguage, onChangeAccessCode, selectId }: Props) {
  const s = strings(language);
  return (
    <>
      {identityControl === "menu" && (
        <label>
          {s.identity}
          <select id={selectId} value={identity} onChange={(e) => onIdentity(e.target.value)}>
            {clientConfig.access.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label[language]}
              </option>
            ))}
          </select>
          <span className="badge">{s.demoPermissions}</span>
        </label>
      )}
      {identityControl === "account" && (
        // 帳號登入：身分是登入的帳號，不能切換（docs/design.md「身分是登入的人，不是設定」）
        <p className="identity-account">
          {s.identity}
          <span>
            {fill(s.signInAccountOption, {
              account: account ?? "",
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
    </>
  );
}
