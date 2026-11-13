// 展示模式的頂端列（#260 PR 2，docs/design.md「展示模式」的「版面」）：取代左側導覽。
// 產品 icon、客戶名稱，下方一行「虛構資料 · 展示用權限」；「問答｜圖譜」分段切換（只有兩個頁籤時改用頂端的分段切換）；
// 右側是身分分段切換（每個身分前標快捷鍵數字；按鍵本身屬於主持人快捷鍵的 Issue）與語言。
// 「身分對照」按鈕在身分分段切換的右側（#261）：只有開關 VITE_DEMO_COMPARE 開啟時傳入 compare；按下切換開關（aria-pressed），快捷鍵是 C。
import { clientConfig } from "../client/load";
import { strings } from "../client/i18n";
import { IDENTITY_SELECT_ID } from "./empty-state";
import type { View } from "./online-demo";
import { ProductIcon } from "./ProductIcon";
import { BRAND_ICON_SIZE } from "./Sidebar";

interface Props {
  language: string;
  identity: string;
  onIdentity(identity: string): void;
  onLanguage(language: string): void;
  views: readonly View[];
  view: View;
  onView(view: View): void;
  // 劇本切換身分時：該身分的徽章以 settle 跳一下（count 換 key 重播動畫）；null 時不跳
  bump: IdentityBump | null;
  // 身分對照（#261）；開關關閉時沒有，不顯示按鈕
  compare?: { open: boolean; disabled: boolean; onToggle(): void };
}

export interface IdentityBump {
  role: string;
  count: number;
}

const ownName = (code: string) => new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;

export function PresentationBar({ language, identity, onIdentity, onLanguage, views, view, onView, bump, compare }: Props) {
  const s = strings(language);
  const tabLabels: Partial<Record<View, string>> = { qa: s.tabQa, graph: s.tabGraph };
  return (
    <header className="presentation-bar">
      <div className="presentation-bar__brand">
        <h1 className="brand">
          <span className="brand__product">
            <ProductIcon size={BRAND_ICON_SIZE} />
            <span className="brand__client">{clientConfig.client.displayName[language]}</span>
          </span>
        </h1>
        {/* 標示不縮小（RFC 0001）：兩個標示各自是 badge，以「·」連成一行 */}
        <p className="presentation-bar__labels">
          <span className="badge">{s.fictionalData}</span>
          <span aria-hidden="true">·</span>
          <span className="badge">{s.demoPermissions}</span>
        </p>
      </div>
      <nav className="primary-tabs segmented" aria-label={s.views}>
        {views.map((id) => (
          <button key={id} type="button" data-view={id} aria-current={view === id ? "page" : undefined} onClick={() => onView(id)}>
            {tabLabels[id] ?? id}
          </button>
        ))}
      </nav>
      <div className="segmented identity-segments" role="radiogroup" aria-label={s.identity}>
        {clientConfig.access.roles.map((role, index) => {
          const checked = role.id === identity;
          const bumping = bump !== null && bump.role === role.id;
          return (
            <label key={role.id} className={checked ? "is-checked" : undefined}>
              <input
                // 空狀態的「切換身分」把焦點移到目前的身分（#245）
                id={checked ? IDENTITY_SELECT_ID : undefined}
                type="radio"
                name="presentation-identity"
                value={role.id}
                checked={checked}
                onChange={() => onIdentity(role.id)}
              />
              <kbd aria-hidden="true">{index + 1}</kbd>
              <span key={bumping ? bump.count : 0} className={bumping ? "identity-segments__name is-bump" : "identity-segments__name"}>
                {role.label[language]}
              </span>
            </label>
          );
        })}
      </div>
      {compare !== undefined && (
        <button type="button" className="secondary presentation-bar__compare" aria-pressed={compare.open} disabled={compare.disabled} onClick={compare.onToggle}>
          <kbd aria-hidden="true">C</kbd>
          {s.presentation.compare}
        </button>
      )}
      <label className="presentation-bar__language">
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
