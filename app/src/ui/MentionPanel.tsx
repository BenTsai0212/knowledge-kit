import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { Graph } from "../graph/read";
import { strings } from "../client/i18n";
import { entityOptionLabel, entityTypeLabel, relatedEntities } from "./graph-labels";
import { GraphView } from "./GraphView";
import { followUps, neighborhood } from "./mentions";
import { staggerIndex } from "./motion";

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
  // 手機（#256）：放在底部面板中，名稱與關閉按鈕在面板的標題列，這裡不另外顯示
  inSheet?: boolean;
}

// 右側的實體面板（#195）：名稱、類型、以它為中心的鄰近圖、關係清單、接著問、在圖譜中查看。
// 名稱與搜尋結果相同，同名的實體加上第一個相關實體的名稱（#198）；鄰近圖只畫小圖，同名以完整的 graph 判斷
export function MentionPanel({ graph, entityId, language, onSelect, onFollowUp, onViewInGraph, onClose, inSheet = false }: Props) {
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
  const name = entityOptionLabel(graph, entity, language);
  const questions = followUps(graph, entityId, language);

  const content = (
    <>
      <GraphView graph={nearby} labelGraph={graph} language={language} selected={entityId} path={null} compact onSelect={onSelect} />
      <h3>{s.relatedEntities}</h3>
      <ul>
        {relatedEntities(graph, entityId, language).map((r) => (
          <li key={r.relationId}>
            {r.outgoing ? `${r.label} → ` : `← ${r.label} `}
            <button type="button" className="link" onClick={() => onSelect(r.entity.id)}>
              {entityOptionLabel(graph, r.entity, language)}
            </button>
          </li>
        ))}
      </ul>
      {questions.length > 0 && (
        <>
          <h3>{s.followUpTitle}</h3>
          <ul className="follow-ups">
            {/* 依序出現（清單的 stagger，#227） */}
            {questions.map((q, i) => (
              <li key={q} style={{ "--i": staggerIndex(i) } as CSSProperties}>
                <button type="button" className="chip" onClick={() => onFollowUp(q)}>
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
    </>
  );
  if (inSheet)
    return (
      <div className="entity mention-panel mention-panel--sheet">
        <span className="badge">{entityTypeLabel(entity.type, language)}</span>
        {content}
      </div>
    );
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
      {content}
    </aside>
  );
}
