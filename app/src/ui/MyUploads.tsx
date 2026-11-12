// 我的上傳（#284，docs/design.md「日常工具」的「我的上傳」）：目前身分上傳、看得到的文件，每份一列附狀態；
// 點一份在右側（手機為底部面板）顯示每一項實體與關係的結果，退回時提供「重新上傳修正版」。
// 資料一律經 readMyUploads()（RLS：migration 0011、ADR 0009）；名稱與標題以文字節點顯示。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fill, strings } from "../client/i18n";
import type { Database } from "../db/database";
import { readMyUploads, type ReviewDocument, type ReviewStatus } from "../extraction/store";
import { entityTypeLabel, relationTypeLabel } from "./graph-labels";
import { canReupload, myUploadStatus, reuploadOf, reviewCounts, reviewSteps, type MyUploadStatus, type ReviewCounts, type ReviewStepName, type Reupload } from "./my-uploads";
import { createRequestGate } from "./requests";

interface Props {
  db: Database;
  identity: string;
  language: string;
  // 這次工作階段還在萃取的文件（萃取中不算萃取完成）
  extracting: ReadonlySet<string>;
  // 內容改變時重新讀取（例如萃取的批次完成）
  refreshKey: string;
  // 本工作階段上傳的文件的萃取狀態（失敗時的提示與重試）；沒有時為 null
  jobStatus(documentId: string): ReactNode;
  onReupload(reupload: Reupload): void;
  // 一開始選取的文件（首頁「有更新」的「查看進度」，#284）
  initialSelected?: string | null;
}

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

export function StatusBadge({ status, language }: { status: MyUploadStatus | ReviewStatus; language: string }) {
  return <span className={BADGE[status]}>{statusLabel(strings(language), status)}</span>;
}

// 送出後的四步進度：已上傳 → 萃取完成 → 等主管審核 → 出現在問答與圖譜，下方說明核准後才會出現
export function ReviewProgress({ counts, language }: { counts: ReviewCounts; language: string }) {
  const m = strings(language).myUploads;
  const names: Record<ReviewStepName, string> = {
    uploaded: m.stepUploaded,
    extracted: m.stepExtracted,
    review: m.stepReview,
    published: m.stepPublished,
  };
  return (
    <div className="review-progress">
      <ol className="upload-steps upload-steps--four" aria-label={m.stepsLabel}>
        {reviewSteps(counts).map((step) => (
          <li key={step.name} className={`upload-step is-${step.status}`} aria-current={step.status === "active" ? "step" : undefined}>
            <span className="upload-step__name">{names[step.name]}</span>
          </li>
        ))}
      </ol>
      <p className="muted">{m.approvalNote}</p>
    </div>
  );
}

const pendingName = (names: Record<string, string>, language: string, fallback: string) => names[language] || Object.values(names)[0] || fallback;

export function MyUploads({ db, identity, language, extracting, refreshKey, jobStatus, onReupload, initialSelected = null }: Props) {
  const s = strings(language);
  const m = s.myUploads;
  const [docs, setDocs] = useState<ReviewDocument[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const reads = useRef(createRequestGate());

  useEffect(() => {
    const ticket = reads.current.begin();
    void readMyUploads(db, identity).then((found) => ticket.isCurrent() && setDocs(found));
    return () => reads.current.cancel();
  }, [db, identity, refreshKey]);

  if (docs === null) return null;
  if (docs.length === 0) return <p className="muted">{m.empty}</p>;

  const countsOf = (doc: ReviewDocument) => reviewCounts(doc, extracting.has(doc.id));
  const doc = docs.find((d) => d.id === selected);

  const detail = (doc: ReviewDocument) => {
    const counts = countsOf(doc);
    const status = myUploadStatus(counts);
    const nameOf = (id: string) => {
      const e = doc.entities.find((x) => x.id === id);
      return e === undefined ? id : pendingName(e.names, language, e.id);
    };
    return (
      <aside className="my-upload-detail" aria-label={doc.title}>
        <header className="dialog-header">
          <h3>{doc.title}</h3>
          <button type="button" className="icon-button" aria-label={s.dialogClose} title={s.dialogClose} onClick={() => setSelected(null)}>
            ✕
          </button>
        </header>
        <StatusBadge status={status} language={language} />
        <ReviewProgress counts={counts} language={language} />
        {jobStatus(doc.id)}
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
        {canReupload(status) && (
          <button type="button" onClick={() => onReupload(reuploadOf(doc))}>
            {m.reupload}
          </button>
        )}
      </aside>
    );
  };

  return (
    <div className={`my-uploads${doc !== undefined ? " with-detail" : ""}`}>
      <ul className="my-uploads__list">
        {docs.map((d) => {
          const counts = countsOf(d);
          return (
            <li key={d.id}>
              <button type="button" className="my-upload" aria-pressed={d.id === selected} onClick={() => setSelected(d.id === selected ? null : d.id)}>
                <strong className="my-upload__title" title={d.title}>
                  {d.title}
                </strong>
                <StatusBadge status={myUploadStatus(counts)} language={language} />
                <span className="muted my-upload__counts">{fill(m.itemCounts, { entities: d.entities.length, relations: d.relations.length }, language)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {doc !== undefined && detail(doc)}
    </div>
  );
}
