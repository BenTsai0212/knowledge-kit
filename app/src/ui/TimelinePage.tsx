import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Database } from "../db/database";
import { readGraph, type Graph } from "../graph/read";
import { readTimeline, type TimelineEntry } from "../graph/timeline";
import { AccessBadges } from "./AccessBadges";
import { entityOptionLabel } from "./graph-labels";
import { PassageMarks } from "./PassageMarks";
import { createRequestGate } from "./requests";
import { EmptyState } from "./EmptyState";
import { goneDelay, withGone } from "./gone-motion";
import { prefersReducedMotion, staggerIndex } from "./motion";
import { dateParts, entityTypeShape, timelineEmptyKind, timelineSections, type TimelineRow } from "./timeline-view";
import { strings } from "../client/i18n";
import { clientConfig } from "../client/load";

interface Props {
  db: Database;
  identity: string;
  language: string;
  // 本次工作階段上傳的文件，加上「上傳」標籤
  uploaded: ReadonlySet<string>;
  // 要捲動到並短暫標示的文件（從上傳頁跳過來時）；處理後呼叫 onFocused
  focus: string | null;
  onFocused(): void;
  onOpenSource(passageId: string): void;
}

// 標示由 CSS 的 timeline-flash 動畫（約 2.5 秒）淡出，animationend 時結束；動畫沒有觸發時（例如瀏覽器停用動畫）以此保底清除
const FLASH_FALLBACK_MS = 4000;

const { entityTypes } = clientConfig.knowledgeModel;

// 實體類型的形狀與顏色（docs/design.md「實體顏色」：形狀＋顏色雙重區分）
function TypeMark({ type }: { type: string }) {
  const color = entityTypes.find((t) => t.id === type)?.color;
  return (
    <span
      className={`type-dot shape-${entityTypeShape(type)}`}
      style={{ "--type-color": color ?? "var(--color-graphFallback)" } as CSSProperties}
      aria-hidden="true"
    />
  );
}

// 日期：桌機接成「YYYY-MM-DD」；手機的日期欄（46px）年與月日分兩行，不顯示中間的「-」（#282）
function DateText({ date }: { date: string }) {
  const { year, monthDay } = dateParts(date);
  return (
    <>
      {year !== null && (
        <>
          <span className="timeline-date__year">{year}</span>
          <span className="timeline-date__sep">-</span>
        </>
      )}
      <span>{monthDay}</span>
    </>
  );
}

// 時間軸頁（#241，docs/design.md）：三欄格線（日期、時間軸線與圓點、文件卡片），依日期由新到舊列出介面語言的文件，
// 沒有日期的文件在最下方的「未註明日期」區。依實體篩選時不符合的文件變淡、不移除，位置不跳動。
// 只列出目前身分看得到的文件（RLS），不顯示看不到的文件的數量或任何痕跡。
// 切換身分或語言時重新讀取，舊結果忽略；篩選的實體已看不到時清除。
// 只切換身分時，讀完前保留舊清單，新身分看不到的文件模糊淡出並收合，其餘補位（gone-motion.ts，#246）
const documentKey = (entry: TimelineEntry) => entry.documentId;

export function TimelinePage({ db, identity, language, uploaded, focus, onFocused, onOpenSource }: Props) {
  const s = strings(language);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const reads = useRef(createRequestGate());
  const list = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // 畫面上的清單是哪個身分、語言讀的；切換身分時的上一份清單與消失播完的時間
  const shown = useRef<{ identity: string; language: string; entries: TimelineEntry[] } | null>(null);
  const [gone, setGone] = useState<{ previous: TimelineEntry[]; ms: number } | null>(null);

  useEffect(() => {
    const ticket = reads.current.begin();
    const previous = shown.current?.language === language ? shown.current : null;
    // 切換語言時清單整個換掉（交叉淡換）；只切換身分時保留舊清單
    if (previous === null) setEntries(null);
    void (async () => {
      // 篩選晶片用的實體也依目前身分讀取；篩選的實體看不到時改為不篩選
      const g = await readGraph(db, identity);
      if (!ticket.isCurrent()) return;
      const timeline = await readTimeline(db, identity, { language });
      if (!ticket.isCurrent()) return;
      setGraph(g);
      setEntityId((current) => (current !== null && g.entities.some((e) => e.id === current) ? current : null));
      const removed = previous === null || previous.identity === identity ? 0 : withGone(previous.entries, timeline, documentKey).filter((r) => r.gone !== null).length;
      const ms = goneDelay(prefersReducedMotion(), removed);
      setGone(ms > 0 && previous !== null ? { previous: previous.entries, ms } : null);
      shown.current = { identity, language, entries: timeline };
      setEntries(timeline);
    })();
    return () => reads.current.cancel();
  }, [db, identity, language]);

  // 消失的文件播完後移除
  useEffect(() => {
    if (gone === null) return;
    const timer = setTimeout(() => setGone(null), gone.ms);
    return () => clearTimeout(timer);
  }, [gone]);

  // onFocused 每次 render 都是新的函式，以 ref 取得最新的，不放進 effect 的相依
  const focused = useRef(onFocused);
  focused.current = onFocused;

  // 時間軸讀完後，捲動到剛上傳的文件並標示
  useEffect(() => {
    if (focus === null || entries === null) return;
    const item = list.current?.querySelector(`[data-document-id="${CSS.escape(focus)}"]`);
    focused.current();
    if (item === null || item === undefined) return;
    item.scrollIntoView({ block: "center" });
    setFlash(focus);
  }, [focus, entries]);

  // 保底：動畫結束事件沒有到時仍會取消標示
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), FLASH_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const byId = new Map(graph?.entities.map((e) => [e.id, e]) ?? []);
  const label = (id: string) => {
    const entity = byId.get(id);
    return graph !== null && entity !== undefined ? entityOptionLabel(graph, entity, language) : id;
  };
  const options =
    graph?.entities
      .map((e) => ({ id: e.id, type: e.type, label: label(e.id) }))
      .sort((a, b) => a.label.localeCompare(b.label, language)) ?? [];
  const languageNames = new Intl.DisplayNames([language], { type: "language" });

  // 消失中的文件：依序的順序（documentId → 第幾個）
  const rows = entries === null ? null : gone === null ? entries.map((item) => ({ item, gone: null })) : withGone(gone.previous, entries, documentKey);
  const goneOrder = new Map(rows?.flatMap((r) => (r.gone === null ? [] : [[r.item.documentId, r.gone] as const])) ?? []);

  const renderRow = ({ entry, matches, entityIds }: TimelineRow) => {
    const mentioned = entityIds.filter((id) => byId.has(id));
    const order = goneOrder.get(entry.documentId);
    return (
      <li
        key={entry.documentId}
        data-document-id={entry.documentId}
        className={`timeline-entry${matches ? "" : " dimmed"}${entry.documentId === flash ? " flash" : ""}${order === undefined ? "" : " is-gone"}`}
        // 消失中的文件不能操作，也不讓輔助科技讀到
        inert={order !== undefined}
        aria-hidden={order === undefined ? undefined : true}
        style={order === undefined ? undefined : ({ "--i": staggerIndex(order) } as CSSProperties)}
        // 淡出動畫結束時取消標示，程式與 CSS 的時間不會不一致
        onAnimationEnd={(e) => e.animationName.startsWith("timeline-flash") && setFlash(null)}
      >
        <time className="timeline-date" dateTime={entry.date ?? undefined}>
          {entry.date !== null && <DateText date={entry.date} />}
        </time>
        <span className="timeline-rail" aria-hidden="true">
          <span className="timeline-dot" />
        </span>
        <div className="card timeline-card">
          <h3>{entry.title}</h3>
          <p className="timeline-meta">
            <AccessBadges visibility={entry.visibility} project={entry.project} language={language} />
            <span className="badge">{languageNames.of(entry.language) ?? entry.language}</span>
            {uploaded.has(entry.documentId) && <span className="badge primary">{s.timelineUploaded}</span>}
          </p>
          {mentioned.length > 0 && (
            <p className="timeline-mentions">
              <span className="muted">{s.timelineMentions}</span>
              {mentioned.map((id) => (
                <span key={id} className="timeline-mention">
                  <TypeMark type={byId.get(id)!.type} />
                  {label(id)}
                </span>
              ))}
            </p>
          )}
          <ul>
            {entry.passages.map((p) => (
              <li key={p.id}>
                <span lang={entry.language}>{p.content}</span>{" "}
                <button type="button" className="link" onClick={() => onOpenSource(p.id)}>
                  {s.openSource}
                </button>
                <PassageMarks marks={p.marks} language={language} onOpenSource={onOpenSource} />
              </li>
            ))}
          </ul>
        </div>
      </li>
    );
  };

  const sections = rows === null ? null : timelineSections(rows.map((r) => r.item), entityId);
  const empty = sections === null ? null : timelineEmptyKind(sections, entityId);

  return (
    <div className="timeline-page">
      <div className="timeline-filter" role="group" aria-label={s.timelineFilter}>
        <button type="button" className="chip" aria-pressed={entityId === null} onClick={() => setEntityId(null)}>
          {s.timelineAll}
        </button>
        {options.map((o) => (
          <button key={o.id} type="button" className="chip" aria-pressed={entityId === o.id} onClick={() => setEntityId(o.id)}>
            <TypeMark type={o.type} />
            {o.label}
          </button>
        ))}
      </div>
      {sections === null ? (
        <p className="card muted">{s.loading}</p>
      ) : empty !== null ? (
        // 篩選後沒有符合的文件時，以空狀態取代全部變淡的清單，下一步是回到全部（#245）
        <EmptyState
          icon="timeline"
          title={s.timelineEmpty}
          reason={empty === "filtered" ? s.timelineFilterEmptyReason : s.timelineEmptyReason}
          actions={empty === "filtered" ? [{ label: s.timelineShowAll, onClick: () => setEntityId(null) }] : []}
        />
      ) : (
        <div ref={list}>
          {sections.dated.length > 0 && <ol className="timeline">{sections.dated.map(renderRow)}</ol>}
          {sections.undated.length > 0 && (
            <section className="timeline-undated">
              <h2>{s.undated}</h2>
              <ol className="timeline">{sections.undated.map(renderRow)}</ol>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
