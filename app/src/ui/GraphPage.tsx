import { useEffect, useRef, useState } from "react";
import { clientConfig } from "../client/load";
import type { Database } from "../db/database";
import { readGraph, type Graph } from "../graph/read";
import { EntityPanel } from "./EntityPanel";
import { GraphView } from "./GraphView";
import { createRequestGate } from "./requests";
import { strings } from "./strings";

interface Props {
  db: Database;
  identity: string;
  language: string;
  onOpenSource(passageId: string): void;
}

// 圖譜頁：切換身分或語言時重新讀取；之後才回來的舊結果忽略；選取的節點已看不到時清除
export function GraphPage({ db, identity, language, onOpenSource }: Props) {
  const s = strings(language);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const reads = useRef(createRequestGate());

  useEffect(() => {
    const ticket = reads.current.begin();
    setGraph(null);
    void readGraph(db, identity).then((g) => {
      if (!ticket.isCurrent()) return;
      setGraph(g);
      setSelected((id) => (id !== null && g.entities.some((e) => e.id === id) ? id : null));
    });
    return () => reads.current.cancel();
  }, [db, identity, language]);

  if (graph === null) return <p className="card muted">{s.loading}</p>;
  if (graph.entities.length === 0) return <p className="card muted">{s.graphEmpty}</p>;

  return (
    <div className="graph-page">
      <section className="card">
        <ul className="legend" aria-label={s.legend}>
          {clientConfig.knowledgeModel.entityTypes.map((t) => (
            <li key={t.id}>
              <span className="swatch" style={{ background: t.color }} />
              {t.label[language]}
            </li>
          ))}
        </ul>
        <GraphView graph={graph} language={language} selected={selected} onSelect={setSelected} />
      </section>
      {selected === null ? (
        <p className="card muted">{s.selectEntity}</p>
      ) : (
        <EntityPanel graph={graph} entityId={selected} language={language} onSelect={setSelected} onOpenSource={onOpenSource} />
      )}
    </div>
  );
}
