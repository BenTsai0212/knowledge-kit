import { useEffect, useMemo, useRef } from "react";
import type { Graph } from "../graph/read";
import { strings } from "../client/i18n";
import { entityName, entityTypeLabel, relatedEntities } from "./graph-labels";
import { GraphView } from "./GraphView";
import { followUps, neighborhood } from "./mentions";

interface Props {
  // 送出這一題當下的身分看得到的圖譜（#195 決定 1）；關係清單、鄰近圖與接著問都只用它
  graph: Graph;
  entityId: string;
  language: string;
  // 點鄰近圖的節點或相關實體：以它為中心
  onSelect(entityId: string): void;
  // 點「接著問」：填進輸入框，不直接送出
  onFollowUp(question: string): void;
  onViewInGraph(entityId: string): void;
  onClose(): void;
}

// 右側的實體面板（#195）：名稱、類型、以它為中心的鄰近圖、關係清單、接著問、在圖譜中查看
export function MentionPanel({ graph, entityId, language, onSelect, onFollowUp, onViewInGraph, onClose }: Props) {
  const s = strings(language);
  const panel = useRef<HTMLElement>(null);
  // 鄰近圖的 graph 換了才重建 cytoscape，所以以 useMemo 保持同一個物件
  const nearby = useMemo(() => neighborhood(graph, entityId), [graph, entityId]);
  // 手機寬度時面板在對話下方：打開或切換中心時捲到面板。不可寫成 () => …scrollIntoView()（見 SourcePanel）
  useEffect(() => {
    void panel.current?.scrollIntoView({ block: "nearest" });
  }, [entityId]);
  const entity = graph.entities.find((e) => e.id === entityId);
  if (entity === undefined) return null;
  const name = entityName(entity, language);
  const questions = followUps(graph, entityId, language);

  return (
    <aside ref={panel} className="card entity mention-panel" aria-label={name}>
      <header>
        <h2>
          {name} <span className="badge">{entityTypeLabel(entity.type, language)}</span>
        </h2>
        <button type="button" className="link" onClick={onClose}>
          {s.closeSource}
        </button>
      </header>
      <GraphView graph={nearby} language={language} selected={entityId} path={null} compact onSelect={onSelect} />
      <h3>{s.relatedEntities}</h3>
      <ul>
        {relatedEntities(graph, entityId, language).map((r) => (
          <li key={r.relationId}>
            {r.outgoing ? `${r.label} → ` : `← ${r.label} `}
            <button type="button" className="link" onClick={() => onSelect(r.entity.id)}>
              {entityName(r.entity, language)}
            </button>
          </li>
        ))}
      </ul>
      {questions.length > 0 && (
        <>
          <h3>{s.followUpTitle}</h3>
          <ul className="follow-ups">
            {questions.map((q) => (
              <li key={q}>
                <button type="button" onClick={() => onFollowUp(q)}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="link" onClick={() => onViewInGraph(entityId)}>
        {s.viewInGraph}
      </button>
    </aside>
  );
}
