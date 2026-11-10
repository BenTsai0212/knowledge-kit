import { useEffect, useMemo, useRef, useState } from "react";
import { clientConfig } from "../client/load";
import type { Database } from "../db/database";
import { shortestPath } from "../graph/path";
import { readGraph, type Graph } from "../graph/read";
import { EntityIcon } from "./EntityIcon";
import { EntityPanel } from "./EntityPanel";
import { GraphView } from "./GraphView";
import { PathPanel } from "./PathPanel";
import { createRequestGate } from "./requests";
import { strings } from "../client/i18n";

interface Props {
  db: Database;
  identity: string;
  language: string;
  onOpenSource(passageId: string): void;
  // 從問答頁的「在圖譜中查看」打開時選取的實體（#195）；看不到時不選取
  initialSelected?: string | null;
}

// 新的圖譜中已看不到的實體一律清除
const keepVisible = (graph: Graph) => (id: string | null) => (id !== null && graph.entities.some((e) => e.id === id) ? id : null);

// 圖譜頁：切換身分或語言時重新讀取；之後才回來的舊結果忽略；選取的節點與路徑的兩端已看不到時清除
export function GraphPage({ db, identity, language, onOpenSource, initialSelected = null }: Props) {
  const s = strings(language);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [ends, setEnds] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const reads = useRef(createRequestGate());

  useEffect(() => {
    const ticket = reads.current.begin();
    setGraph(null);
    void readGraph(db, identity).then((g) => {
      if (!ticket.isCurrent()) return;
      const keep = keepVisible(g);
      setGraph(g);
      setSelected(keep);
      setEnds(({ from, to }) => ({ from: keep(from), to: keep(to) }));
    });
    return () => reads.current.cancel();
  }, [db, identity, language]);

  // 路徑由目前的可見圖算出，切換身分後一律重新計算
  const path = useMemo(
    () => (graph === null || ends.from === null || ends.to === null ? null : shortestPath(graph, ends.from, ends.to)),
    [graph, ends],
  );

  if (graph === null) return <p className="card muted">{s.loading}</p>;
  if (graph.entities.length === 0) return <p className="card muted">{s.graphEmpty}</p>;

  return (
    <div className="graph-page">
      <section className="card">
        <ul className="legend" aria-label={s.legend}>
          {clientConfig.knowledgeModel.entityTypes.map((t) => (
            <li key={t.id}>
              <EntityIcon icon={t.icon} color={t.color} />
              {t.label[language]}
            </li>
          ))}
        </ul>
        <GraphView graph={graph} language={language} selected={selected} path={path} onSelect={setSelected} />
      </section>
      <PathPanel
        graph={graph}
        language={language}
        from={ends.from}
        to={ends.to}
        path={path}
        onChange={(from, to) => setEnds({ from, to })}
        onOpenSource={onOpenSource}
      />
      {selected === null ? (
        <p className="card muted">{s.selectEntity}</p>
      ) : (
        <EntityPanel graph={graph} entityId={selected} language={language} onSelect={setSelected} onOpenSource={onOpenSource} />
      )}
    </div>
  );
}
