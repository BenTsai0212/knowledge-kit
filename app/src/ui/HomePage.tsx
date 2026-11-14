// 首頁（#283，docs/design.md「日常工具」的「首頁」）：登入後的預設頁，展示模式不顯示。資料只在瀏覽器記憶體，重新整理就重來。
// 所有數字與清單只算目前身分讀得到的（讀取經 withIdentity()，由 RLS 篩選；#247）。一般員工的「有更新」經 readMyUploads()（#284，ADR 0009）
// 與 readReports()（回報已處理，#286，migration 0012）。
// 桌機（wide）對齊畫板 docs/design/v1/boards/K-Home.dc.html（#331）：問候與提問框在上，下面是 auto-fit 的兩欄卡片。
// 手機（phone）對齊畫板 docs/design/v1/boards/K-Mobile.dc.html 的首頁（#356）：單行提問框、主管的數字卡在最上、每則一列可以點；
// 平板維持單欄。
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { clientConfig } from "../client/load";
import type { Database } from "../db/database";
import { readMyUploads } from "../extraction/store";
import { readReports, writeReport, type AnswerReport } from "../reports/store";
import { readEntitiesByIds, readRecentDocuments, type RecentDocument, type RecentEntity } from "../graph/recent";
import { fill, strings } from "../client/i18n";
import { LevelBadge, ProjectBadge } from "./AccessBadges";
import { EmptyState } from "./EmptyState";
import { entityName } from "./graph-labels";
import { ReportForm } from "./AnswerView";
import {
  askedWhen,
  entityShape,
  greetingPeriod,
  MAX_UPDATES,
  reportUpdates,
  UPLOAD_DOT,
  uploadUpdates,
  visibleScope,
  waitingRows,
  type AskedQuestion,
  type UpdateDot,
  type UploadUpdate,
  type WaitingSummary,
} from "./home";
import { reportAgainOf } from "./report-helpers";
import { ReportResult } from "./ReportResult";
import { statusLabel } from "./MyUploads";
import { QuestionPanel } from "./QuestionPanel";

interface Props {
  // 資料庫還在載入時為 null
  db: Database | null;
  language: string;
  identity: string;
  // 桌機（≥ 1025px）：畫板 K-Home 的版面（#331）
  wide: boolean;
  // 手機（≤ 600px）：畫板 K-Mobile 的首頁（#356）；省略時是平板或桌機
  phone?: boolean;
  // 主管的「等你處理」：沒有 canReview 的身分不顯示（undefined）；讀取中為 null
  waiting?: WaitingSummary | null;
  // 一般員工的「有更新」：不能審核的身分才有（其他為 undefined）；自己上傳的文件（#284）與已處理的回報（#286）。
  // extracting：本工作階段還在萃取的文件；onOpenUpload：「查看進度」打開上傳頁的我的上傳並選取該份
  updates?: { extracting: ReadonlySet<string>; onOpenUpload(documentId: string): void };
  // 問過的問題（問題文字與提問時間，最新的在前；不存回答）
  asked: readonly AskedQuestion[];
  askDisabled: boolean;
  limit: string | null;
  draft: string;
  onDraft(text: string): void;
  // 提問與「再問一次」：切到問答頁，用現在看得到的資料回答
  onAsk(question: string): void;
  onStartReview(): void;
  // 最近看過的實體 id（最新的在前）；名稱與能否看到在這裡以目前身分讀取
  viewed: readonly string[];
  // 最近新增的文件：在時間軸打開
  onOpenDocument(documentId: string): void;
  // 最近看過的實體：在圖譜打開
  onOpenEntity(entityId: string): void;
}

// 最近新增的文件與最近看過的實體；切換身分、語言或看過的實體時重新讀取，之後才回來的舊結果忽略
function useRecent(db: Database | null, identity: string, language: string, viewed: readonly string[]) {
  const [recent, setRecent] = useState<{ documents: RecentDocument[]; entities: RecentEntity[] } | null>(null);
  useEffect(() => {
    if (db === null) return;
    let cancelled = false;
    setRecent(null);
    void Promise.all([readRecentDocuments(db, identity, language), readEntitiesByIds(db, identity, viewed)]).then(([documents, entities]) => {
      if (!cancelled) setRecent({ documents, entities });
    });
    return () => {
      cancelled = true;
    };
  }, [db, identity, language, viewed]);
  return recent;
}

// 一般員工的「有更新」：已處理的回報在前（處理時間新的在前），其次是自己上傳的文件，合計最多三則。
// 切換身分或萃取狀態改變時重新讀取，之後才回來的舊結果忽略
function useUpdates(db: Database | null, identity: string, extracting: ReadonlySet<string> | undefined) {
  const [updates, setUpdates] = useState<{ reports: AnswerReport[]; uploads: UploadUpdate[] } | null>(null);
  useEffect(() => {
    if (db === null || extracting === undefined) return;
    let cancelled = false;
    setUpdates(null);
    void Promise.all([readReports(db, identity), readMyUploads(db, identity)]).then(([all, docs]) => {
      const reports = reportUpdates(all, identity);
      if (!cancelled) setUpdates({ reports, uploads: uploadUpdates(docs, extracting, MAX_UPDATES - reports.length) });
    });
    return () => {
      cancelled = true;
    };
  }, [db, identity, extracting]);
  return updates;
}

// 狀態點（8px）：顏色只是輔助，狀態另有文字（標題或副標）
const Dot = ({ dot }: { dot: UpdateDot }) => <span className={`home__dot home__dot--${dot}`} aria-hidden="true" />;

// 「有更新」的一列：桌機與平板在右側放動作按鈕；手機整列是按鈕、右側是 ›（畫板 K-Mobile），名稱與動作按鈕相同
function UpdateRow(props: { phone: boolean; action: string; label: string; expanded?: boolean; onClick(): void; children: ReactNode }) {
  const { phone, action, label, expanded, onClick, children } = props;
  if (phone)
    return (
      <button type="button" className="home__row home__row--raised home__row--tap" aria-label={label} aria-expanded={expanded} onClick={onClick}>
        {children}
        <span className="home__chevron" aria-hidden="true">
          ›
        </span>
      </button>
    );
  return (
    <div className="home__row home__row--raised">
      {children}
      <button type="button" className="home__action" aria-expanded={expanded} aria-label={label} onClick={onClick}>
        {action}
      </button>
    </div>
  );
}

// 文件的可見範圍標籤（畫板：等級 · 專案，中性色）
function scopeTag(visibility: string, project: string | null, language: string): string {
  const { visibilityLevels, projects } = clientConfig.access;
  const level = visibilityLevels.find((l) => l.id === visibility)?.label[language] ?? visibility;
  return project === null ? level : `${level} · ${projects.find((p) => p.id === project)?.label[language] ?? project}`;
}

export function HomePage(props: Props) {
  const { db, language, identity, wide, phone = false, waiting, updates: updatesProps, asked, askDisabled, limit, draft, onDraft, onAsk, onStartReview, viewed, onOpenDocument, onOpenEntity } = props;
  const s = strings(language);
  const recent = useRecent(db, identity, language, viewed);
  const updates = useUpdates(db, identity, updatesProps?.extracting);
  // 「看處理結果」展開的回報，與「仍有疑問，再回報一次」的回報
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [againReport, setAgainReport] = useState<string | null>(null);
  const scope = visibleScope(clientConfig.access, identity);
  const time = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const relative = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const now = new Date();
  const ago = (at: string) => {
    const when = askedWhen(at, now);
    return relative.format(when.value, when.unit);
  };
  const waitingTitle = { documents: s.home.waitingDocuments, conflicts: s.home.waitingConflicts, reports: s.home.waitingReports };
  const rows = waiting ? waitingRows(waiting) : [];
  // 手機的區塊不是卡片：background 上的標題與列（畫板 K-Mobile）
  const card = phone ? "home__card" : "card home__card";
  const updateCount = updates === null ? 0 : updates.reports.length + updates.uploads.length;

  const waitingSection = waiting !== undefined && (
    <section className={`${card} home__waiting`} aria-labelledby="home-waiting">
      {/* 手機只有數字卡與「開始審核」，標題給輔助技術 */}
      <h3 id="home-waiting" className={phone ? "visually-hidden" : undefined}>
        {s.home.waitingTitle}
      </h3>
      {waiting === null ? (
        <p className="muted">{s.loading}</p>
      ) : rows.length === 0 ? (
        <EmptyState as="div" icon="review" title={s.home.waitingNone} />
      ) : phone ? (
        // 手機（#356）：待審文件（副標是說法不同的組數）與回報有錯（副標是最早一則的相對時間）兩張數字卡，下方一個「開始審核」
        <>
          <div className="home__stats">
            <div className={waiting.conflicts > 0 ? "home__stat home__stat--conflict" : "home__stat"}>
              <span className="home__stat-count">{waiting.documents}</span>
              <span className="home__stat-label">{s.home.pendingDocuments}</span>
              {waiting.conflicts > 0 && <span className="home__stat-sub">{fill(s.home.waitingConflicts, { count: waiting.conflicts })}</span>}
            </div>
            <div className="home__stat">
              <span className="home__stat-count">{waiting.reports}</span>
              <span className="home__stat-label">{s.home.pendingReports}</span>
              {waiting.earliestReport !== null && (
                <time className="home__stat-sub" dateTime={waiting.earliestReport} title={time.format(new Date(waiting.earliestReport))}>
                  {fill(s.home.earliestShort, { time: ago(waiting.earliestReport) })}
                </time>
              )}
            </div>
          </div>
          <button type="button" className="home__start" onClick={onStartReview}>
            {s.home.startReview}
          </button>
        </>
      ) : (
        <ul className="home__list">
          {rows.map((r) => {
            const title = fill(waitingTitle[r.kind], { count: r.count });
            const action = r.kind === "reports" ? s.home.handleReports : s.home.startReview;
            return (
              <li key={r.kind} className="home__row home__row--raised">
                <Dot dot={r.dot} />
                <span className="home__text">
                  <strong className="home__name">{title}</strong>
                  <span className="home__sub">
                    {r.kind === "documents" ? (
                      s.home.waitingDocumentsNote
                    ) : r.kind === "conflicts" ? (
                      s.home.waitingConflictsNote
                    ) : waiting.earliestReport !== null ? (
                      fill(s.home.waitingEarliest, { time: time.format(new Date(waiting.earliestReport)) })
                    ) : null}
                  </span>
                </span>
                <button type="button" className="home__action" aria-label={`${action}${s.colon}${title}`} onClick={onStartReview}>
                  {action}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const updatesSection = updatesProps !== undefined && (
    <section className={`${card} home__updates`} aria-labelledby="home-updates">
      <h3 id="home-updates">
        {s.home.updatesTitle}
        {/* 手機的標題後面是則數（畫板 K-Mobile） */}
        {phone && updateCount > 0 && <span className="home__count"> {updateCount}</span>}
      </h3>
      {updates === null ? (
        <p className="muted">{s.loading}</p>
      ) : updateCount === 0 ? (
        <EmptyState as="div" icon="upload" title={s.home.updatesEmptyTitle} reason={s.home.updatesEmpty} />
      ) : (
        <ul className="home__list">
          {updates.reports.map((r) => (
            <li key={r.id}>
              <UpdateRow
                phone={phone}
                action={s.reportResult.viewResult}
                label={`${s.reportResult.viewResult}${s.colon}${r.question}`}
                expanded={openReport === r.id}
                onClick={() => setOpenReport(openReport === r.id ? null : r.id)}
              >
                <Dot dot="success" />
                <span className="home__text">
                  <strong className="home__name">{s.reportResult.resolved}</strong>
                  {/* 問題可以截斷：完整文字放在 title */}
                  <span className="home__sub" title={r.question}>
                    {r.question}
                  </span>
                </span>
              </UpdateRow>
              {/* 回報結果沿用回答下方的卡片（docs/design.md「回報結果」） */}
              {openReport === r.id && (
                <ReportResult
                  language={language}
                  report={r}
                  onReportAgain={() => setAgainReport(r.id)}
                  onAskAgain={() => onAsk(r.question)}
                  askDisabled={askDisabled || limit !== null}
                />
              )}
              {againReport === r.id && db !== null && (
                <ReportForm
                  language={language}
                  initial={r.category}
                  open
                  onReport={(category, note) => writeReport(db, identity, reportAgainOf(r, category, note)).then(() => undefined)}
                  onCancel={() => setAgainReport(null)}
                />
              )}
            </li>
          ))}
          {updates.uploads.map((u) => {
            const action = u.entityId !== null ? s.viewInGraph : s.home.viewProgress;
            return (
              <li key={u.documentId}>
                <UpdateRow
                  phone={phone}
                  action={action}
                  label={`${action}${s.colon}${u.title}`}
                  onClick={() => (u.entityId !== null ? onOpenEntity(u.entityId) : updatesProps.onOpenUpload(u.documentId))}
                >
                  <Dot dot={UPLOAD_DOT[u.status]} />
                  <span className="home__text">
                    {/* 標題可以截斷：完整文字放在 title */}
                    <strong className="home__name" title={u.title}>
                      {u.title}
                    </strong>
                    <span className="home__sub">
                      <span>{statusLabel(s, u.status)}</span>
                      {/* 審核中：主管核准後才會出現在問答與圖譜 */}
                      {u.status === "in_review" && (
                        <>
                          {" · "}
                          <span>{s.myUploads.approvalNote}</span>
                        </>
                      )}
                    </span>
                  </span>
                </UpdateRow>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const askedSection = (
    <section className={`${card} home__asked`} aria-labelledby="home-asked">
      <h3 id="home-asked">{s.home.askedTitle}</h3>
      {asked.length === 0 ? (
        <EmptyState as="div" icon="question" title={s.home.askedEmpty} />
      ) : (
        <ul className="home__list">
          {asked.map(({ question, at }) => {
            const label = `${s.home.askAgain}${s.colon}${question}`;
            const disabled = askDisabled || limit !== null;
            const parts = (
              <>
                {/* 名稱可以截斷：完整文字放在 title（docs/design.md「英文版面」的排版規則） */}
                <span className="home__question" title={question}>
                  {question}
                </span>
                <time className="home__when" dateTime={at} title={time.format(new Date(at))}>
                  {ago(at)}
                </time>
              </>
            );
            return phone ? (
              // 手機：每則一行（問題與相對時間），整行就是「再問一次」
              <li key={question}>
                <button type="button" className="home__row home__row--line home__row--tap" disabled={disabled} aria-label={label} onClick={() => onAsk(question)}>
                  {parts}
                </button>
              </li>
            ) : (
              <li key={question} className="home__row home__row--line">
                {parts}
                <button type="button" className="home__again" disabled={disabled} aria-label={label} onClick={() => onAsk(question)}>
                  {s.home.askAgain}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="home__note">{s.home.askedNote}</p>
    </section>
  );

  const documentsSection = (
    <section className={`${card} home__documents`} aria-labelledby="home-documents">
      <h3 id="home-documents">{s.home.recentDocumentsTitle}</h3>
      {recent === null ? (
        <p className="muted">{s.loading}</p>
      ) : recent.documents.length === 0 ? (
        <EmptyState as="div" icon="timeline" title={s.home.recentDocumentsEmpty} />
      ) : (
        <ul className="home__list">
          {recent.documents.map((d) => (
            <li key={d.id} className="home__row home__row--line">
              {d.date !== null && (
                <time className="home__when" dateTime={d.date}>
                  {d.date}
                </time>
              )}
              <button type="button" className="link home__name" title={d.title} onClick={() => onOpenDocument(d.id)}>
                {d.title}
              </button>
              <span className="home__tag">{scopeTag(d.visibility, d.project, language)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const viewedSection = (
    <section className={`${card} home__viewed`} aria-labelledby="home-viewed">
      <h3 id="home-viewed">{s.home.viewedTitle}</h3>
      {recent === null ? (
        <p className="muted">{s.loading}</p>
      ) : recent.entities.length === 0 ? (
        <EmptyState as="div" icon="graph" title={s.home.viewedEmptyTitle} reason={s.home.viewedEmpty} />
      ) : (
        <>
          <ul className="home__chips">
            {recent.entities.map((e) => {
              const type = clientConfig.knowledgeModel.entityTypes.find((t) => t.id === e.type);
              const name = entityName(e, language);
              return (
                <li key={e.id}>
                  <button type="button" className="home__chip" title={name} aria-label={`${s.viewInGraph}${s.colon}${name}`} onClick={() => onOpenEntity(e.id)}>
                    <span
                      className={`home__shape home__shape--${entityShape(type?.icon)}`}
                      style={{ "--type-color": type?.color ?? "var(--color-graphFallback)" } as CSSProperties}
                      aria-hidden="true"
                    />
                    <span className="home__entity-name">{name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="home__note">{s.home.viewedNote}</p>
        </>
      )}
    </section>
  );

  return (
    <div className={wide ? "home home--wide" : phone ? "home home--phone" : "home"}>
      <header className="home__top">
        <h2>{s.home[greetingPeriod(now.getHours())]}</h2>
        {/* 可見範圍：桌機在左側欄的使用者卡（#330），手機在身分與語言面板（#255、#356）；只有平板在問候下方 */}
        {!wide && !phone && (
          <p className="home__scope">
            <span className="muted">
              {s.home.scope}
              {s.colon}
            </span>
            {scope.levels.map((id) => (
              <LevelBadge key={id} visibility={id} language={language} />
            ))}
            {scope.projects.map((id) => (
              <ProjectBadge key={id} project={id} language={language} />
            ))}
          </p>
        )}
      </header>
      {/* 手機的主管：待辦的數字放最上（畫板 K-Mobile） */}
      {phone && waitingSection}
      <QuestionPanel language={language} disabled={askDisabled} text={draft} onText={onDraft} onAsk={onAsk} limit={limit} role={identity} compact={wide || phone} />
      <div className="home__cards">
        {phone ? (
          // 手機：一般員工是有更新、問過的問題；主管是最近新增的文件（畫板 K-Mobile）；其他區塊接在後面
          waiting !== undefined ? (
            <>
              {documentsSection}
              {askedSection}
            </>
          ) : (
            <>
              {updatesSection}
              {askedSection}
              {documentsSection}
            </>
          )
        ) : (
          <>
            {waitingSection}
            {updatesSection}
            {askedSection}
            {documentsSection}
          </>
        )}
        {viewedSection}
      </div>
    </div>
  );
}
