import { useEffect, useRef, useState } from "react";
import type { Database } from "../db/database";
import { readGraph, type Graph } from "../graph/read";
import { readTimeline, type TimelineEntry } from "../graph/timeline";
import { entityOptionLabel } from "./graph-labels";
import { createRequestGate } from "./requests";
import { strings } from "./strings";

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

const FLASH_MS = 2000;

// 時間軸頁：依日期由新到舊列出介面語言的文件，可依實體篩選。切換身分或語言時重新讀取，舊結果忽略；篩選的實體已看不到時清除
export function TimelinePage({ db, identity, language, uploaded, focus, onFocused, onOpenSource }: Props) {
  const s = strings(language);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const reads = useRef(createRequestGate());
  const list = useRef<HTMLOListElement>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const ticket = reads.current.begin();
    setEntries(null);
    void (async () => {
      // 篩選選單用的實體也依目前身分讀取；篩選的實體看不到時改為不篩選
      const g = await readGraph(db, identity);
      if (!ticket.isCurrent()) return;
      const filter = entityId !== null && g.entities.some((e) => e.id === entityId) ? entityId : null;
      const timeline = await readTimeline(db, identity, { language, ...(filter !== null && { entityId: filter }) });
      if (!ticket.isCurrent()) return;
      setGraph(g);
      setEntityId(filter);
      setEntries(timeline);
    })();
    return () => reads.current.cancel();
  }, [db, identity, language, entityId]);

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

  // 標示一段時間後取消
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const options =
    graph?.entities
      .map((e) => ({ id: e.id, label: entityOptionLabel(graph, e, language) }))
      .sort((a, b) => a.label.localeCompare(b.label, language)) ?? [];

  return (
    <div className="timeline-page">
      <section className="card">
        <label>
          {s.timelineFilter}
          <select value={entityId ?? ""} onChange={(e) => setEntityId(e.target.value === "" ? null : e.target.value)}>
            <option value="">{s.timelineAll}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </section>
      {entries === null ? (
        <p className="card muted">{s.loading}</p>
      ) : entries.length === 0 ? (
        <p className="card muted">{s.timelineEmpty}</p>
      ) : (
        <ol className="timeline" ref={list}>
          {entries.map((entry) => (
            <li key={entry.documentId} data-document-id={entry.documentId} className={entry.documentId === flash ? "card flash" : "card"}>
              <h3>
                <time dateTime={entry.date ?? undefined}>{entry.date ?? s.undated}</time> {entry.title}
                {uploaded.has(entry.documentId) && <span className="badge">{s.timelineUploaded}</span>}
              </h3>
              <ul>
                {entry.passages.map((p) => (
                  <li key={p.id}>
                    <span lang={entry.language}>{p.content}</span>{" "}
                    <button type="button" className="link" onClick={() => onOpenSource(p.id)}>
                      {s.openSource}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
