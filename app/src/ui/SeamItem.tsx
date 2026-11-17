// 接縫卡片的「項目本身」一列（畫板 S-Review ①、S-Request 的 .item）：待審頁的接縫卡（ReviewPage.tsx）與上傳者首頁
// 「有更新」的請上傳者確認（RequestAsk.tsx）共用。surfaceRaised 底的方塊，依序是類型膠囊（色點＋類型名稱，只有實體）、
// 粗體的名稱、textMuted 的其他語言名稱、「出處（N）」文字連結（有 onSources 時）。名稱以文字節點顯示
import type { CSSProperties } from "react";
import { fill, strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import { entityTypeLabel } from "./graph-labels";
import { entityTypeShape } from "./timeline-view";

interface Props {
  language: string;
  // 實體的類型；關係省略（沒有類型膠囊）
  entityType?: string;
  name: string;
  // 名稱的語言（文件的語言）
  nameLanguage?: string;
  // 其他語言的名稱
  others?: Array<{ language: string; text: string }>;
  // 出處：數量大於 0 時顯示「出處（N）」文字連結
  sources?: { count: number; open: boolean; onToggle(): void };
}

const typeColor = (type: string) => clientConfig.knowledgeModel.entityTypes.find((t) => t.id === type)?.color ?? "var(--color-graphFallback)";

export function SeamItem({ language, entityType, name, nameLanguage, others = [], sources }: Props) {
  const s = strings(language);
  return (
    <p className="ask-card__item">
      {entityType !== undefined && (
        <span className={`ask-card__kind shape-${entityTypeShape(entityType)}`} style={{ "--type-color": typeColor(entityType) } as CSSProperties}>
          <span className="type-dot" aria-hidden="true" />
          {entityTypeLabel(entityType, language)}
        </span>
      )}
      <strong lang={nameLanguage}>{name}</strong>
      {others.map((o) => (
        <span key={o.language} className="ask-card__other" lang={o.language}>
          {o.text}
        </span>
      ))}
      {sources !== undefined && sources.count > 0 && (
        <button type="button" className="link ask-card__sources" aria-expanded={sources.open} onClick={sources.onToggle}>
          {fill(s.reviewSources, { count: sources.count }, language)}
        </button>
      )}
    </p>
  );
}
