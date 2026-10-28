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
  onOpenSource(passageId: string): void;
}

// 時間軸頁：依日期列出介面語言的文件，可依實體篩選。切換身分或語言時重新讀取，舊結果忽略；篩選的實體已看不到時清除
export function TimelinePage({ db, identity, language, onOpenSource }: Props) {
  const s = strings(language);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const reads = useRef(createRequestGate());

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
        <ol className="timeline">
          {entries.map((entry) => (
            <li key={entry.documentId} className="card">
              <h3>
                <time dateTime={entry.date ?? undefined}>{entry.date ?? s.undated}</time> {entry.title}
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
