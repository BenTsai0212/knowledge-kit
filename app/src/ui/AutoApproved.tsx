// 待審頁的「已直接收錄 N 項」區（ADR 0011 決定 5，docs/design.md「待審的接縫」）：client.json 的 review.mode 為 seams 時，
// 每份文件的接縫與其他待審項目下方。預設收合，只有標題、說明與兩個按鈕：「隨機抽查 3 項」（每按一次重新抽）與「展開全部」。
// 每項可以撤回並選理由（名稱錯了、關係用錯了、不該合併、不該收錄、其他）；撤回後項目回到待審，這裡標示「已撤回」與理由。
// 列的內容（類型、名稱、出處）由 ReviewPage.tsx 畫；抽查與分類在 seam-review.ts（autoItems()、sample()）
import { useId, useState, type ReactNode } from "react";
import { fill, strings } from "../client/i18n";
import type { RetractReason } from "../extraction/store";
import { sample, type AutoItem } from "./seam-review";

const REASONS: readonly RetractReason[] = ["name", "relation", "merge", "exclude", "other"];
const SAMPLE_SIZE = 3;

interface Props {
  language: string;
  active: AutoItem[];
  retracted: AutoItem[];
  busy: boolean;
  // 一項的內容（類型、名稱、合併對象、出處的開關）與列下方展開的出處
  row(item: AutoItem): ReactNode;
  detail(item: AutoItem): ReactNode;
  onRetract(decisionId: string, reason: RetractReason): void;
  // 測試用：抽查的亂數
  random?: () => number;
}

export function AutoApproved({ language, active, retracted, busy, row, detail, onRetract, random }: Props) {
  const s = strings(language);
  const ids = useId();
  // closed：收合；sample：抽查的項目（撤回後仍留在清單中、標示「已撤回」）；all：全部（含已撤回）
  const [view, setView] = useState<{ kind: "closed" } | { kind: "sample"; ids: string[] } | { kind: "all" }>({ kind: "closed" });
  // 正在選撤回理由的項目與選中的理由
  const [retracting, setRetracting] = useState<{ id: string; reason: RetractReason | null } | null>(null);
  const reasonLabels: Record<RetractReason, string> = {
    name: s.seamReasonName,
    relation: s.seamReasonRelation,
    merge: s.seamReasonMerge,
    exclude: s.seamReasonExclude,
    other: s.seamReasonOther,
  };
  // 兩者不重疊：每個項目最多一筆直接收錄的決定，撤回後就不是目前有效的決定
  const all = [...active, ...retracted];
  const activeIds = new Set(active.map((x) => x.item.id));
  const shown = view.kind === "all" ? all : view.kind === "sample" ? all.filter((x) => view.ids.includes(x.item.id)) : [];
  const listId = `${ids}-list`;

  return (
    <section className="review-auto" aria-labelledby={`${ids}-title`}>
      <h3 className="review-auto__title" id={`${ids}-title`}>
        {fill(s.seamAutoSection, { count: active.length }, language)}
        {retracted.length > 0 && <span className="review-auto__retracted">{fill(s.seamAutoRetractedCount, { count: retracted.length }, language)}</span>}
      </h3>
      <p className="review-auto__hint">{s.seamAutoHint}</p>
      <div className="review-auto__actions">
        <button
          type="button"
          className="secondary"
          disabled={active.length === 0}
          aria-controls={listId}
          onClick={() => setView({ kind: "sample", ids: sample(active, SAMPLE_SIZE, random).map((x) => x.item.id) })}
        >
          {fill(s.seamAutoSample, { count: Math.min(SAMPLE_SIZE, active.length) }, language)}
        </button>
        <button
          type="button"
          className="secondary"
          aria-expanded={view.kind === "all"}
          aria-controls={listId}
          onClick={() => setView(view.kind === "all" ? { kind: "closed" } : { kind: "all" })}
        >
          {view.kind === "all" ? s.reviewCollapse : s.seamAutoShowAll}
        </button>
      </div>
      <ul className="review-auto__list" id={listId}>
        {shown.map((x) => {
          const item = x.item;
          const isActive = activeIds.has(item.id);
          const open = retracting?.id === item.id;
          const reason = item.autoRetracted?.reason ?? null;
          return (
            <li key={item.id} className={isActive ? "review-auto__item" : "review-auto__item is-retracted"}>
              <div className="review-row">
                {row(x)}
                {!isActive && (
                  <span className="review-mark is-retracted">
                    {s.seamAutoRetracted}
                    {reason !== null && `${s.colon}${reasonLabels[reason]}`}
                  </span>
                )}
                {isActive && item.decisionId !== null && !open && (
                  <span className="review-actions">
                    <button type="button" className="secondary" disabled={busy} onClick={() => setRetracting({ id: item.id, reason: null })}>
                      {s.seamAutoRetract}
                    </button>
                  </span>
                )}
              </div>
              {detail(x)}
              {open && item.decisionId !== null && (
                <div className="review-auto__reasons">
                  <span className="review-auto__reasons-title" id={`${ids}-reason-${item.id}`}>
                    {s.seamAutoReasonTitle}
                  </span>
                  {/* 理由是膠囊（畫板 S-Review 的 .rc），一次只能選一個；選了才能按「撤回」 */}
                  <div className="review-auto__chips" role="group" aria-labelledby={`${ids}-reason-${item.id}`}>
                    {REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className="review-auto__reason"
                        aria-pressed={retracting.reason === r}
                        disabled={busy}
                        onClick={() => setRetracting({ id: item.id, reason: r })}
                      >
                        {reasonLabels[r]}
                      </button>
                    ))}
                  </div>
                  <div className="review-auto__confirm">
                    <button type="button" className="secondary" disabled={busy} onClick={() => setRetracting(null)}>
                      {s.seamAutoCancel}
                    </button>
                    <button
                      type="button"
                      disabled={busy || retracting.reason === null}
                      onClick={() => {
                        if (retracting.reason === null || item.decisionId === null) return;
                        onRetract(item.decisionId, retracting.reason);
                        setRetracting(null);
                      }}
                    >
                      {s.seamAutoRetract}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
