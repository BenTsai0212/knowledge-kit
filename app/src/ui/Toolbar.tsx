import { clientConfig } from "../client/load";
import { strings } from "./strings";

interface Props {
  language: string;
  identity: string;
  onIdentity(identity: string): void;
  onLanguage(language: string): void;
  onChangeAccessCode?(): void;
}

// 語言以該語言自己的名稱顯示（例如 zh-TW → 中文（台灣））
const ownName = (code: string) => new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;

export function Toolbar({ language, identity, onIdentity, onLanguage, onChangeAccessCode }: Props) {
  const s = strings(language);
  return (
    <header className="toolbar">
      <h1>{clientConfig.client.displayName[language]}</h1>
      <span className="badge">{s.fictionalData}</span>
      <label>
        {s.identity}
        <select value={identity} onChange={(e) => onIdentity(e.target.value)}>
          {clientConfig.access.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label[language]}
            </option>
          ))}
        </select>
        <span className="badge">{s.demoPermissions}</span>
      </label>
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
          {s.changeAccessCode}
        </button>
      )}
    </header>
  );
}
