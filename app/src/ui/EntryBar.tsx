// 桌機登入頁的頂端列（#334，畫板 K-Login）：登入前沒有左側導覽，改成一條細列。
// 左邊是 icon＋「Knowledge Kit」／客戶名稱與「虛構資料」「展示用權限」標籤，右邊是語言選單。畫板上的 MOTION、LIGHT／DARK 按鈕是設計稿用，不實作
import { clientConfig } from "../client/load";
import { strings } from "../client/i18n";
import { ownName } from "./IdentityControls";
import { ProductIcon } from "./ProductIcon";

// 畫板的 icon 尺寸（32px 以下是簡化版）
const ENTRY_ICON_SIZE = 30;

interface Props {
  language: string;
  onLanguage(language: string): void;
}

export function EntryBar({ language, onLanguage }: Props) {
  const s = strings(language);
  return (
    <header className="entry-bar">
      <h1 className="entry-bar__brand">
        <ProductIcon size={ENTRY_ICON_SIZE} />
        <span className="entry-bar__wordmark">{s.productName}</span>
        <span className="entry-bar__sep" aria-hidden="true">
          /
        </span>
        <span className="entry-bar__client">{clientConfig.client.displayName[language]}</span>
      </h1>
      <span className="badge entry-bar__tag">{s.fictionalData}</span>
      <span className="badge entry-bar__tag">{s.demoPermissions}</span>
      <label className="entry-bar__language">
        {s.language}
        <select value={language} onChange={(e) => onLanguage(e.target.value)}>
          {clientConfig.client.languages.map((code) => (
            <option key={code} value={code}>
              {ownName(code)}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}
