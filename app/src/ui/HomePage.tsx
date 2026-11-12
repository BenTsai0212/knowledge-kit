// 首頁（#283，docs/design.md「日常工具」的「首頁」）：登入後的預設頁，展示模式不顯示。資料只在瀏覽器記憶體，重新整理就重來。
// 所有數字只算目前身分讀得到的（讀取經 withIdentity()，由 RLS 篩選；#247）。
import { clientConfig } from "../client/load";
import { strings } from "../client/i18n";
import { LevelBadge, ProjectBadge } from "./AccessBadges";
import { greetingPeriod, visibleScope, type WaitingSummary } from "./home";
import { QuestionPanel } from "./QuestionPanel";

interface Props {
  language: string;
  identity: string;
  // 主管的「等你處理」：沒有 canReview 的身分不顯示（undefined）；讀取中為 null
  waiting?: WaitingSummary | null;
  // 問過的問題（只有問題文字，最新的在前）
  asked: readonly string[];
  askDisabled: boolean;
  limit: string | null;
  draft: string;
  onDraft(text: string): void;
  // 提問與「再問一次」：切到問答頁，用現在看得到的資料回答
  onAsk(question: string): void;
  onStartReview(): void;
}

export function HomePage({ language, identity, waiting, asked, askDisabled, limit, draft, onDraft, onAsk, onStartReview }: Props) {
  const s = strings(language);
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
    </div>
  );
}
