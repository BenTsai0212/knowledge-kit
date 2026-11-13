// 手機的身分與語言面板的內容（#255 PR 2，docs/design.md「問答（手機）」的身分與語言面板）：
// 身分以單選卡列出，每張附 access.json 的 roles[].scope（一句「看得到什麼」，只說明看得到的範圍，#247）；
// 語言是分段切換；最下方是「更換邀請碼」。帳號登入時身分固定，只顯示帳號與角色，按鈕是「登出」。
// 平板的滑出面板與桌機左側欄的使用者卡選單（#330）也用這一份；桌機的帳號已在使用者卡上，選單只有語言與「登出」（hideAccount）。
import { useId } from "react";
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import type { IdentityControl } from "./sign-in";

// 語言以該語言自己的名稱顯示（例如 zh-TW → 中文（台灣））；桌機左側欄登入頁的語言選單共用
export const ownName = (code: string) => new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;

interface Props {
  language: string;
  identity: string;
  identityControl: IdentityControl;
  account?: string;
  onIdentity(identity: string): void;
  onLanguage(language: string): void;
  onChangeAccessCode?(): void;
  // 帳號登入時不顯示帳號與角色（桌機的使用者卡上已有，#330 決定 2）
  hideAccount?: boolean;
}

export function IdentitySheet({ language, identity, identityControl, account, onIdentity, onLanguage, onChangeAccessCode, hideAccount = false }: Props) {
  const s = strings(language);
  const id = useId();
  const roles = clientConfig.access.roles;
  return (
    <>
      {identityControl === "menu" && (
        <fieldset className="role-cards">
          <legend>{s.identity}</legend>
          {roles.map((r) => (
            // 名稱是單選鈕的名稱、說明是描述，整張卡都可以點
            <label key={r.id} className="role-card">
              <input
                type="radio"
                name={`${id}-identity`}
                value={r.id}
                checked={identity === r.id}
                onChange={() => onIdentity(r.id)}
                aria-labelledby={`${id}-${r.id}-name`}
                aria-describedby={`${id}-${r.id}-scope`}
              />
              <span className="role-card__text">
                <span id={`${id}-${r.id}-name`} className="role-card__name">
                  {r.label[language]}
                </span>
                <span id={`${id}-${r.id}-scope`} className="role-card__scope">
                  {r.scope[language]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {identityControl === "account" && !hideAccount && (
        // 帳號登入：身分是登入的帳號，不能切換（docs/design.md「身分是登入的人，不是設定」）
        <p className="identity-account">
          {s.identity}
          <span>
            {fill(s.signInAccountOption, {
              account: account ?? "",
              role: roles.find((r) => r.id === identity)?.label[language] ?? identity,
            })}
          </span>
        </p>
      )}
      <div className="language-segmented" role="group" aria-labelledby={`${id}-language`}>
        <span id={`${id}-language`}>{s.language}</span>
        <div className="language-segmented__options">
          {clientConfig.client.languages.map((code) => (
            <button key={code} type="button" lang={code} aria-pressed={code === language} onClick={() => onLanguage(code)}>
              {ownName(code)}
            </button>
          ))}
        </div>
      </div>
      {onChangeAccessCode && (
        <button type="button" className="link" onClick={onChangeAccessCode}>
          {account === undefined ? s.changeAccessCode : s.signOut}
        </button>
      )}
    </>
  );
}
