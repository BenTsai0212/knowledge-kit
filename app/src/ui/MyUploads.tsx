// 我的上傳（#284，docs/design.md「日常工具」的「我的上傳」）：目前身分上傳、看得到的文件，每份一列附狀態；
// 點一份在右側（手機為底部面板）顯示每一項實體與關係的結果，退回時提供「重新上傳修正版」。
// 桌機（#344，畫板 K-Uploads）：每份一列（surfaceRaised 底、文件日期、狀態膠囊），上傳詳情是頁面右側的整高欄，
// 「看原文」在詳情中打開原文，萃取出的實體以類型色底線標出（畫板 B-Ingest）。
// 資料由 UploadPage 經 readMyUploads() 讀取（RLS：migration 0011、ADR 0009）；名稱與標題以文字節點顯示。
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import type { Database } from "../db/database";
import type { MyUploadDocument, ReviewStatus } from "../extraction/store";
import { readSource } from "../sources/source";
import { entityTypeLabel, relationTypeLabel } from "./graph-labels";
import {
  canReupload,
  myUploadStatus,
  reuploadOf,
  reviewCounts,
  reviewSteps,
  uploadTerms,
  type ExtractionPhase,
  type MyUploadStatus,
  type ReviewCounts,
  type ReviewStepName,
  type Reupload,
} from "./my-uploads";
import { createRequestGate } from "./requests";
import { underlineRanges, type FoundTerm } from "./upload-helpers";

const { knowledgeModel } = clientConfig;
const typeColor = (type: string) => knowledgeModel.entityTypes.find((t) => t.id === type)?.color ?? "var(--color-graphFallback)";

// 每份的狀態與每一項的結果共用同一組文字
export function statusLabel(s: ReturnType<typeof strings>, status: MyUploadStatus | ReviewStatus): string {
  const m = s.myUploads;
  return {
    uploaded: m.statusUploaded,
    in_review: m.statusInReview,
    pending: m.statusInReview,
    approved: m.statusApproved,
    partly_rejected: m.statusPartlyRejected,
    rejected: m.statusRejected,
  }[status];
}

const BADGE: Record<MyUploadStatus | ReviewStatus, string> = {
  uploaded: "badge",
  in_review: "badge warning",
  pending: "badge warning",
  approved: "badge primary",
  partly_rejected: "badge danger",
  rejected: "badge danger",
};

// data-status：桌機的狀態膠囊依狀態換底色（#344）
export function StatusBadge({ status, language }: { status: MyUploadStatus | ReviewStatus; language: string }) {
  return (
    <span className={BADGE[status]} data-status={status}>
      {statusLabel(strings(language), status)}
    </span>
  );
}

// 送出後的四步進度：已上傳 → 萃取完成 → 等主管審核 → 出現在問答與圖譜，下方說明核准後才會出現。
// title（桌機送出後，#344）：一張卡片，文件名與說明在上、四段進度條在下（完成 success、目前 primary）
export function ReviewProgress({ counts, language, title }: { counts: ReviewCounts; language: string; title?: string }) {
  const m = strings(language).myUploads;
  const names: Record<ReviewStepName, string> = {
    uploaded: m.stepUploaded,
    extracted: m.stepExtracted,
    review: m.stepReview,
    published: m.stepPublished,
  };
  const steps = (
    <ol className="upload-steps upload-steps--four" aria-label={m.stepsLabel}>
      {reviewSteps(counts).map((step) => (
        <li key={step.name} className={`upload-step is-${step.status}`} aria-current={step.status === "active" ? "step" : undefined}>
          <span className="upload-step__name">{names[step.name]}</span>
        </li>
      ))}
    </ol>
  );
  if (title !== undefined)
    return (
      <section className="review-progress review-progress--card" aria-label={fill(m.submitted, { title })}>
        <p className="review-progress__head">
          <strong>{fill(m.submitted, { title })}</strong> <span className="muted">{m.approvalNote}</span>
        </p>
        {steps}
      </section>
    );
  return (
    <div className="review-progress">
      {steps}
      <p className="muted">{m.approvalNote}</p>
    </div>
  );
}

// 桌機上傳詳情的摘要下方：目前狀態的說明（#344 審查）
const STATUS_NOTE: Record<MyUploadStatus, (m: ReturnType<typeof strings>["myUploads"]) => string> = {
  uploaded: (m) => m.noItems,
  in_review: (m) => m.noteInReview,
  approved: (m) => m.noteApproved,
  partly_rejected: (m) => m.notePartlyRejected,
  rejected: (m) => m.noteRejected,
};

const pendingName = (names: Record<string, string>, language: string, fallback: string) => names[language] || Object.values(names)[0] || fallback;

interface ListProps {
  docs: MyUploadDocument[];
  selected: string | null;
  onSelect(id: string | null): void;
  extracting: ReadonlySet<string>;
  language: string;
  desktop: boolean;
}

export function MyUploadList({ docs, selected, onSelect, extracting, language, desktop }: ListProps) {
  const s = strings(language);
  const m = s.myUploads;
  if (docs.length === 0) return <p className="muted">{m.empty}</p>;
  return (
    <ul className="my-uploads__list">
      {docs.map((d) => {
        const status = myUploadStatus(reviewCounts(d, extracting.has(d.id)));
        const counts = fill(m.itemCounts, { entities: d.entities.length, relations: d.relations.length }, language);
        return (
          <li key={d.id}>
            <button type="button" className="my-upload" aria-pressed={d.id === selected} onClick={() => onSelect(d.id === selected ? null : d.id)}>
              {desktop ? (
                // 桌機：標題與「日期 · 項目數」在左，狀態膠囊在右
                <>
                  <span className="my-upload__text">
                    <strong className="my-upload__title" title={d.title}>
                      {d.title}
                    </strong>
                    <span className="my-upload__meta">
                      <span className="my-upload__date">{d.date ?? s.undated}</span> · {counts}
                    </span>
                  </span>
                  <StatusBadge status={status} language={language} />
                </>
              ) : (
                <>
                  <strong className="my-upload__title" title={d.title}>
                    {d.title}
                  </strong>
                  <StatusBadge status={status} language={language} />
                  <span className="muted my-upload__counts">{counts}</span>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface DetailProps {
  db: Database;
  identity: string;
  doc: MyUploadDocument;
  language: string;
  extracting: boolean;
  // 本工作階段上傳的文件的萃取狀態（失敗時的提示與重試）；沒有時為 null。
  // 桌機只傳進度（萃取中）或錯誤（萃取或比對失敗），萃取的處理紀錄不顯示（#344 審查）
  jobStatus: ReactNode;
  // 本工作階段的萃取在哪個階段；不是本工作階段上傳的文件為 null（桌機在 null 或 done 時顯示摘要）
  phase: ExtractionPhase | null;
  onReupload(reupload: Reupload): void;
  onClose(): void;
  desktop: boolean;
}

export function UploadDetail({ db, identity, doc, language, extracting, jobStatus, phase, onReupload, onClose, desktop }: DetailProps) {
  const s = strings(language);
  const m = s.myUploads;
  const counts = reviewCounts(doc, extracting);
  const status = myUploadStatus(counts);
  const nameOf = (id: string) => {
    const e = doc.entities.find((x) => x.id === id);
    return e === undefined ? id : pendingName(e.names, language, e.id);
  };
  const reupload = canReupload(status) && (
    <button type="button" onClick={() => onReupload(reuploadOf(doc))}>
      {m.reupload}
    </button>
  );

  if (!desktop)
    return (
      <aside className="my-upload-detail" aria-label={doc.title}>
        <header className="dialog-header">
          <h3>{doc.title}</h3>
          <button type="button" className="icon-button" aria-label={s.dialogClose} title={s.dialogClose} onClick={onClose}>
            ✕
          </button>
        </header>
        <StatusBadge status={status} language={language} />
        <ReviewProgress counts={counts} language={language} />
        {jobStatus}
        {counts.total === 0 && !counts.extracting && <p className="muted">{m.noItems}</p>}
        {doc.entities.length > 0 && (
          <>
            <h4>{m.entities}</h4>
            <ul className="my-upload-items">
              {doc.entities.map((e) => (
                <li key={e.id}>
                  <span>
                    {pendingName(e.names, language, e.id)} <span className="muted">{entityTypeLabel(e.type, language)}</span>
                  </span>
                  <StatusBadge status={e.status} language={language} />
                </li>
              ))}
            </ul>
          </>
        )}
        {doc.relations.length > 0 && (
          <>
            <h4>{m.relations}</h4>
            <ul className="my-upload-items">
              {doc.relations.map((r) => (
                <li key={r.id}>
                  <span>
                    {nameOf(r.from)} —{relationTypeLabel(r.type, language)}→ {nameOf(r.to)}
                  </span>
                  <StatusBadge status={r.status} language={language} />
                </li>
              ))}
            </ul>
          </>
        )}
        {reupload}
      </aside>
    );

  // 桌機的上傳詳情：每組萃取結果一列（類型色點、名稱、結果），下方是「看原文」與重新上傳修正版
  type Item = { id: string; name: string; color: string | null; status: ReviewStatus; type: string };
  const items: Item[] = [
    ...doc.entities.map((e) => ({
      id: e.id,
      name: pendingName(e.names, language, e.id),
      color: typeColor(e.type),
      status: e.status,
      type: entityTypeLabel(e.type, language),
    })),
    ...doc.relations.map((r) => ({
      id: r.id,
      name: `${nameOf(r.from)} —${relationTypeLabel(r.type, language)}→ ${nameOf(r.to)}`,
      color: null,
      status: r.status,
      type: m.relations,
    })),
  ];
  return (
    <aside className="upload-detail" aria-labelledby={`upload-detail-${doc.id}`}>
      <div className="upload-detail__head">
        <p className="upload-detail__eyebrow">{m.detail}</p>
        <button type="button" className="icon-button" aria-label={s.dialogClose} title={s.dialogClose} onClick={onClose}>
          ✕
        </button>
      </div>
      <h2 id={`upload-detail-${doc.id}`}>{doc.title}</h2>
      <p className="my-upload__meta">
        <span className="my-upload__date">{doc.date ?? s.undated}</span>
      </p>
      <StatusBadge status={status} language={language} />
      {jobStatus}
      {/* 萃取完成後（或不是本工作階段上傳的文件）：一句摘要與目前狀態的說明（畫板 K-Uploads），不顯示萃取的處理紀錄 */}
      {(phase === null || phase === "done") &&
        (counts.total === 0 ? (
          <p className="muted">{m.noItems}</p>
        ) : (
          <p className="upload-detail__summary">
            {fill(m.extractSummary, { entities: doc.entities.length, relations: doc.relations.length }, language)}
            <span className="upload-detail__note">{STATUS_NOTE[status](m)}</span>
          </p>
        ))}
      {items.length > 0 && (
        <ul className="upload-detail__items">
          {items.map((i) => (
            <li key={i.id}>
              <span className="type-dot" style={{ "--type-color": i.color ?? "var(--color-textMuted)" } as CSSProperties} aria-hidden="true" />
              <span className="upload-detail__name">
                {i.name} <span className="visually-hidden">{i.type}</span>
              </span>
              <span className="upload-detail__state" data-status={i.status}>
                {statusLabel(s, i.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <UploadSource key={doc.id} db={db} identity={identity} doc={doc} language={language} />
      {reupload}
    </aside>
  );
}

// 「看原文」：打開時讀取這份文件中看得到的段落（readSource()，RLS），段落前加 ¶N，萃取出的實體以類型色底線標出
function UploadSource({ db, identity, doc, language }: { db: Database; identity: string; doc: MyUploadDocument; language: string }) {
  const s = strings(language);
  const m = s.myUploads;
  const [open, setOpen] = useState(false);
  const [passages, setPassages] = useState<{ id: string; content: string }[] | null>(null);
  const reads = useRef(createRequestGate());
  const id = useId();

  useEffect(() => {
    if (!open || doc.firstPassage === null) return;
    const ticket = reads.current.begin();
    void readSource(db, identity, doc.firstPassage).then((found) => ticket.isCurrent() && setPassages(found?.passages ?? []));
    return () => reads.current.cancel();
  }, [open, db, identity, doc.firstPassage]);

  if (doc.firstPassage === null) return null;
  const terms = uploadTerms(doc);
  return (
    <>
      <div className="upload-detail__actions">
        <button type="button" className="secondary" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          {open ? m.hideSource : m.viewSource}
        </button>
      </div>
      {open && (
        <section id={id} className="upload-source" aria-label={s.sourceTitle} lang={doc.language}>
          {passages?.map((p, i) => (
            <div key={p.id} className="source-passage">
              <span className="source-passage__n" lang={language}>
                {fill(s.paragraphNumber, { n: i + 1 })}
              </span>
              <p>{underlined(p.content, terms)}</p>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function underlined(text: string, terms: FoundTerm[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const r of underlineRanges(text, terms)) {
    if (r.start > at) parts.push(text.slice(at, r.start));
    parts.push(
      <span key={r.start} className="upload-entity" style={{ "--type-color": typeColor(r.type) } as CSSProperties}>
        {text.slice(r.start, r.end)}
      </span>,
    );
    at = r.end;
  }
  parts.push(text.slice(at));
  return parts;
}
