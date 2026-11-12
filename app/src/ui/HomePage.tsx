// 首頁（#283，docs/design.md「日常工具」的「首頁」）：登入後的預設頁，展示模式不顯示。資料只在瀏覽器記憶體，重新整理就重來。
// 所有數字與清單只算目前身分讀得到的（讀取經 withIdentity()，由 RLS 篩選；#247）。一般員工的「有更新」經 readMyUploads()（#284，ADR 0009）。
import { useEffect, useState } from "react";
import { clientConfig } from "../client/load";
import type { Database } from "../db/database";
import { readMyUploads } from "../extraction/store";
import { readEntitiesByIds, readRecentDocuments, type RecentDocument, type RecentEntity } from "../graph/recent";
import { strings } from "../client/i18n";
import { LevelBadge, ProjectBadge } from "./AccessBadges";
import { entityName } from "./graph-labels";
import { greetingPeriod, uploadUpdates, visibleScope, type UploadUpdate, type WaitingSummary } from "./home";
import { StatusBadge } from "./MyUploads";
import { QuestionPanel } from "./QuestionPanel";

interface Props {
  // 資料庫還在載入時為 null
  db: Database | null;
  language: string;
  identity: string;
  // 主管的「等你處理」：沒有 canReview 的身分不顯示（undefined）；讀取中為 null
  waiting?: WaitingSummary | null;
  // 一般員工的「有更新」（#284）：能上傳、不能審核的身分才有（其他為 undefined）。
  // extracting：本工作階段還在萃取的文件；onOpenUpload：「查看進度」打開上傳頁的我的上傳並選取該份
  updates?: { extracting: ReadonlySet<string>; onOpenUpload(documentId: string): void };
  // 問過的問題（只有問題文字，最新的在前）
  asked: readonly string[];
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

// 一般員工的「有更新」：自己上傳的文件；切換身分或萃取狀態改變時重新讀取，之後才回來的舊結果忽略
function useUpdates(db: Database | null, identity: string, extracting: ReadonlySet<string> | undefined) {
  const [updates, setUpdates] = useState<UploadUpdate[] | null>(null);
  useEffect(() => {
    if (db === null || extracting === undefined) return;
    let cancelled = false;
    setUpdates(null);
    void readMyUploads(db, identity).then((docs) => {
      if (!cancelled) setUpdates(uploadUpdates(docs, extracting));
    });
    return () => {
      cancelled = true;
    };
  }, [db, identity, extracting]);
  return updates;
}

export function HomePage({ db, language, identity, waiting, updates: updatesProps, asked, askDisabled, limit, draft, onDraft, onAsk, onStartReview, viewed, onOpenDocument, onOpenEntity }: Props) {
  const s = strings(language);
  const recent = useRecent(db, identity, language, viewed);
  const updates = useUpdates(db, identity, updatesProps?.extracting);
  const scope = visibleScope(clientConfig.access, identity);
  const time = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="home">
      <header className="home__top">
        <h2>{s.home[greetingPeriod(new Date().getHours())]}</h2>
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
      </header>
      <QuestionPanel language={language} disabled={askDisabled} text={draft} onText={onDraft} onAsk={onAsk} limit={limit} role={identity} />
      {waiting !== undefined && (
        <section className="card home__waiting" aria-labelledby="home-waiting">
          <h3 id="home-waiting">{s.home.waitingTitle}</h3>
          {waiting === null ? (
            <p className="muted">{s.loading}</p>
          ) : waiting.total === 0 ? (
            <p className="muted">{s.home.waitingNone}</p>
          ) : (
            <>
              <dl className="home__counts">
                <div>
                  <dt>{s.home.waitingDocuments}</dt>
                  <dd>{waiting.documents}</dd>
                </div>
                <div>
                  <dt>{s.home.waitingConflicts}</dt>
                  <dd>{waiting.conflicts}</dd>
                </div>
                <div>
                  <dt>{s.home.waitingReports}</dt>
                  <dd>{waiting.reports}</dd>
                </div>
                {waiting.earliestReport !== null && (
                  <div>
                    <dt>{s.home.waitingEarliest}</dt>
                    <dd>
                      <time dateTime={waiting.earliestReport}>{time.format(new Date(waiting.earliestReport))}</time>
                    </dd>
                  </div>
                )}
              </dl>
              <button type="button" onClick={onStartReview}>
                {s.home.startReview}
              </button>
            </>
          )}
        </section>
      )}
      {updatesProps !== undefined && (
        <section className="card home__updates" aria-labelledby="home-updates">
          <h3 id="home-updates">{s.home.updatesTitle}</h3>
          {updates === null ? (
            <p className="muted">{s.loading}</p>
          ) : updates.length === 0 ? (
            <p className="muted">{s.home.updatesEmpty}</p>
          ) : (
            <ul>
              {updates.map((u) => (
                <li key={u.documentId}>
                  <div className="home__update">
                    {/* 標題可以截斷：完整文字放在 title */}
                    <strong className="home__name" title={u.title}>
                      {u.title}
                    </strong>
                    <StatusBadge status={u.status} language={language} />
                    {u.entityId !== null ? (
                      <button type="button" className="link" aria-label={`${s.viewInGraph}${s.colon}${u.title}`} onClick={() => onOpenEntity(u.entityId!)}>
                        {s.viewInGraph}
                      </button>
                    ) : (
                      <button type="button" className="link" aria-label={`${s.home.viewProgress}${s.colon}${u.title}`} onClick={() => updatesProps.onOpenUpload(u.documentId)}>
                        {s.home.viewProgress}
                      </button>
                    )}
                  </div>
                  {/* 審核中：主管核准後才會出現在問答與圖譜 */}
                  {u.status === "in_review" && <p className="muted">{s.myUploads.approvalNote}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="card home__asked" aria-labelledby="home-asked">
        <h3 id="home-asked">{s.home.askedTitle}</h3>
        <p className="muted">{s.home.askedNote}</p>
        {asked.length === 0 ? (
          <p className="muted">{s.home.askedEmpty}</p>
        ) : (
          <ul>
            {asked.map((question) => (
              <li key={question}>
                {/* 名稱可以截斷：完整文字放在 title（docs/design.md「英文版面」的排版規則） */}
                <span className="home__question" title={question}>
                  {question}
                </span>
                <button type="button" disabled={askDisabled || limit !== null} aria-label={`${s.home.askAgain}${s.colon}${question}`} onClick={() => onAsk(question)}>
                  {s.home.askAgain}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card home__recent" aria-labelledby="home-documents">
        <h3 id="home-documents">{s.home.recentDocumentsTitle}</h3>
        {recent === null ? (
          <p className="muted">{s.loading}</p>
        ) : recent.documents.length === 0 ? (
          <p className="muted">{s.home.recentDocumentsEmpty}</p>
        ) : (
          <ul>
            {recent.documents.map((d) => (
              <li key={d.id}>
                <button type="button" className="link home__name" title={d.title} onClick={() => onOpenDocument(d.id)}>
                  {d.title}
                </button>
                {d.date !== null && (
                  <time className="muted" dateTime={d.date}>
                    {d.date}
                  </time>
                )}
                <LevelBadge visibility={d.visibility} language={language} />
                {d.project !== null && <ProjectBadge project={d.project} language={language} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card home__recent" aria-labelledby="home-viewed">
        <h3 id="home-viewed">{s.home.viewedTitle}</h3>
        {recent === null ? (
          <p className="muted">{s.loading}</p>
        ) : recent.entities.length === 0 ? (
          <p className="muted">{s.home.viewedEmpty}</p>
        ) : (
          <ul>
            {recent.entities.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="link home__name"
                  title={entityName(e, language)}
                  aria-label={`${s.viewInGraph}${s.colon}${entityName(e, language)}`}
                  onClick={() => onOpenEntity(e.id)}
                >
                  {entityName(e, language)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
