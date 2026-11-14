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
import { conflictDocuments, dateParts, entityTypeShape, languageTag, timelineEmptyKind, timelineMonths, timelineSections, yearGroups, type TimelineRow } from "./timeline-view";
import { useLayout } from "./layout";
import { presentationMode } from "./online-demo";
import { fill, strings } from "../client/i18n";
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

// 日期：平板與展示模式接成「YYYY-MM-DD」；桌機（#346）與手機（#358）只放 MM-DD，年份在分組標題
function DateText({ date, monthOnly }: { date: string; monthOnly: boolean }) {
  const { year, monthDay } = dateParts(date);
  return (
    <>
      {year !== null && !monthOnly && (
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
  // 桌機（≥ 1025px，展示模式除外，#346 畫板 F-Timeline）：頁首與範圍、一列篩選、依年份分組、精簡卡片（展開後才列出段落）。
  // 手機（≤ 600px，展示模式除外，#358 畫板 G-Mobile-Pages）：同一套精簡卡片與年份分組，頁首只有文件數，卡片不列「提到」與語言短標
  const layout = useLayout();
  const desktop = layout === "desktop" && !presentationMode;
  const phone = layout === "phone" && !presentationMode;
  const compact = desktop || phone;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (documentId: string) =>
    setExpanded((ids) => {
      const next = new Set(ids);
      if (!next.delete(documentId)) next.add(documentId);
      return next;
    });

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
    // 桌機的卡片預設精簡：剛上傳的文件展開段落
    setExpanded((ids) => new Set(ids).add(focus));
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
          {entry.date !== null && <DateText date={entry.date} monthOnly={compact} />}
        </time>
        <span className="timeline-rail" aria-hidden="true">
          <span className="timeline-dot" />
        </span>
        {compact ? compactCard(entry, mentioned) : (
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
            {passageList(entry)}
          </div>
        )}
      </li>
    );
  };

  const passageList = (entry: TimelineEntry) => (
    <ul className="timeline-passages">
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
  );

  // 桌機的精簡卡片（#346）：標題、可見範圍、語言短標、說法不同的小膠囊、「提到：…」一行；段落清單與「打開原文」在展開後顯示。
  // 手機（#358）：標題、可見範圍、說法不同的小膠囊，不列語言短標與「提到」
  const compactCard = (entry: TimelineEntry, mentioned: string[]) => {
    const open = expanded.has(entry.documentId);
    const passagesId = `timeline-passages-${entry.documentId}`;
    return (
      <div className="card timeline-card">
        <div className="timeline-card__head">
          <h3>{entry.title}</h3>
          <AccessBadges visibility={entry.visibility} project={entry.project} language={language} />
          {desktop && (
            <abbr className="timeline-lang" title={languageNames.of(entry.language) ?? entry.language}>
              {languageTag(entry.language)}
            </abbr>
          )}
          {uploaded.has(entry.documentId) && <span className="badge primary">{s.timelineUploaded}</span>}
        </div>
        {conflictDocuments(entry).map((d) => (
          <span key={d.documentId} className="timeline-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M7 4v16M17 4v16M3 8h8M13 16h8" />
            </svg>
            {fill(s.conflictMarks.conflict, { title: d.title })}
          </span>
        ))}
        {desktop && mentioned.length > 0 && <p className="timeline-mentions-line">{fill(s.timelineMentionsLine, { names: mentioned.map(label).join(s.listSeparator) })}</p>}
        <button type="button" className="timeline-toggle" aria-expanded={open} aria-controls={open ? passagesId : undefined} onClick={() => toggle(entry.documentId)}>
          {open ? s.timelineHidePassages : fill(s.timelineShowPassages, { count: entry.passages.length }, language)}
        </button>
        {open && <div id={passagesId}>{passageList(entry)}</div>}
      </div>
    );
  };

  const sections = rows === null ? null : timelineSections(rows.map((r) => r.item), entityId);
  const empty = sections === null ? null : timelineEmptyKind(sections, entityId);

  // 桌機頁首的範圍與文件數：只算目前身分看得到的文件（entries 經 RLS；消失中的文件不算）
  const months = entries === null ? null : timelineMonths(entries, language);
  const documents = entries === null ? null : fill(s.timelineDocuments, { count: entries.length }, language);
  const summary = documents === null ? null : months === null ? documents : fill(s.timelineSummary, { range: months.to === null ? months.from : fill(s.timelineMonthRange, { from: months.from, to: months.to }), documents });
  // 篩選時，符合的文件的圓點用該實體的類型色（畫板 F-Timeline）
  const filterColor = entityId === null ? undefined : (entityTypes.find((t) => t.id === byId.get(entityId)?.type)?.color ?? "var(--color-primary)");

  const datedList = (dated: TimelineRow[]) =>
    compact ? (
      yearGroups(dated).map((g) => (
        <section key={g.year ?? ""} className="timeline-year">
          {g.year !== null && <h2>{g.year}</h2>}
          <ol className="timeline">{g.rows.map(renderRow)}</ol>
        </section>
      ))
    ) : (
      <ol className="timeline">{dated.map(renderRow)}</ol>
    );

  return (
    <div
      className={
        desktop ? `timeline-page timeline-page--desktop${entityId === null ? "" : " is-filtered"}` : phone ? "timeline-page timeline-page--phone" : "timeline-page"
      }
      style={desktop && filterColor !== undefined ? ({ "--filter-color": filterColor } as CSSProperties) : undefined}
    >
      {compact && (
        <header className="timeline-head">
          <h1>{s.tabTimeline}</h1>
          {/* 手機的頁首只有文件數（畫板 G-Mobile-Pages） */}
          {(desktop ? summary : documents) !== null && <p className="muted">{desktop ? summary : documents}</p>}
        </header>
      )}
      <div className="timeline-filter" role="group" aria-label={s.timelineFilter}>
        {desktop && (
          <span className="timeline-filter__label" aria-hidden="true">
            {s.timelineFilter}
          </span>
        )}
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
          {sections.dated.length > 0 && datedList(sections.dated)}
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
