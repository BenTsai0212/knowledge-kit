import { useState } from "react";
import { clientConfig } from "../client/load";
import type { DocumentRetraction } from "../extraction/store";
import type { Graph } from "../graph/read";
import { relationCounts } from "../graph/search";
import { EntityIcon } from "./EntityIcon";
import { entityOptionLabel, entityTypeLabel, relatedEntities, relationTypeLabel, sourcesForLanguage } from "./graph-labels";
import { fill, strings } from "../client/i18n";

interface Props {
  graph: Graph;
  entityId: string;
  language: string;
  // 點關係清單中的實體：從它繼續展開（#199）
  onSelect(entityId: string): void;
  // 只看它：從它重新開始展開
  onShowOnly(entityId: string): void;
  // 在問答中問：填進問答頁的輸入框，不送出
  onAskAbout(entityId: string): void;
  onOpenSource(passageId: string): void;
  // 經審核進來、目前身分可以撤回的文件（ADR 0007；沒有 canReview 時為空）
  retractions: DocumentRetraction[];
  // 撤回這份文件的核准；失敗時回傳錯誤訊息
  onRetract(retraction: DocumentRetraction): Promise<string | null>;
}

// 圖譜頁右側的實體面板（#199）：名稱、類型、關聯數與文件數；在問答中問、只看它；
// 關係清單（方向、關係名稱、對方、出處數，點對方從它展開）；出現在哪些文件（點了打開原文）。全部只用可見圖。
// 經審核進來的文件可以「撤回這份文件的核准」：先列出撤回後會從圖譜消失的實體與關係，確認後才撤回（ADR 0007）。
// 名稱與搜尋結果相同，同名的實體加上第一個相關實體的名稱（#198）
export function EntityPanel({ graph, entityId, language, onSelect, onShowOnly, onAskAbout, onOpenSource, retractions, onRetract }: Props) {
  const s = strings(language);
  // 正在確認撤回的文件、撤回中、錯誤訊息
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entity = graph.entities.find((e) => e.id === entityId);
  if (entity === undefined) return null;
  const name = entityOptionLabel(graph, entity, language);
  const type = clientConfig.knowledgeModel.entityTypes.find((t) => t.id === entity.type);
  const relations = new Map(graph.relations.map((r) => [r.id, r]));
  // 同一份文件的段落只列一次，點了打開第一段；出處優先顯示介面語言（#36）
  const documents = sourcesForLanguage(entity.sources, language).filter((p, i, all) => all.findIndex((q) => q.documentId === p.documentId) === i);

  const retractionOf = (documentId: string) => retractions.find((r) => r.documentId === documentId);
  const entityName = (id: string) => {
    const e = graph.entities.find((x) => x.id === id);
    return e === undefined ? id : entityOptionLabel(graph, e, language);
  };
  const relationLabel = (id: string) => {
    const r = relations.get(id);
    return r === undefined ? id : `${entityName(r.from)} —${relationTypeLabel(r.type, language)}→ ${entityName(r.to)}`;
  };
  const confirmBox = (r: DocumentRetraction) => {
    const removed = [...r.entities.map(entityName), ...r.relations.map(relationLabel)];
    const submit = async () => {
      setBusy(true);
      const message = await onRetract(r);
      setBusy(false);
      setError(message);
      if (message === null) setConfirming(null);
    };
    return (
      <div className="retract-confirm" role="group" aria-label={s.graphRetract}>
        {removed.length > 0 ? (
          <>
            <p>{s.graphRetractWillRemove}</p>
            <ul>
              {removed.map((label, i) => (
                <li key={i}>{label}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>{s.graphRetractNoChange}</p>
        )}
        {error !== null && <p className="error">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void submit()}>
          {s.graphRetractConfirm}
        </button>{" "}
        <button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(null)}>
          {s.graphRetractCancel}
        </button>
      </div>
    );
  };

  return (
    <section className="card entity" aria-label={name}>
      <h2>{name}</h2>
      <p className="entity-type">
        {type !== undefined && <EntityIcon icon={type.icon} color={type.color} />}
        {entityTypeLabel(entity.type, language)}
      </p>
      <p className="muted">
        {fill(s.graphRelationCount, { count: relationCounts(graph).get(entityId) ?? 0 })}
        {" · "}
        {fill(s.graphDocumentCount, { count: documents.length })}
      </p>
      <div className="entity-actions">
        <button type="button" onClick={() => onAskAbout(entityId)}>
          {s.graphAskAbout}
        </button>
        <button type="button" onClick={() => onShowOnly(entityId)}>
          {s.graphShowOnly}
        </button>
      </div>
      <h3>{s.relatedEntities}</h3>
      <ul>
        {relatedEntities(graph, entityId, language).map((r) => (
          <li key={r.relationId}>
            {r.outgoing ? `${r.label} → ` : `← ${r.label} `}
            <button type="button" className="link" onClick={() => onSelect(r.entity.id)}>
              {entityOptionLabel(graph, r.entity, language)}
            </button>{" "}
            <span className="muted">{fill(s.graphSourceCount, { count: relations.get(r.relationId)?.sources.length ?? 0 })}</span>
          </li>
        ))}
      </ul>
      <h3>{s.entitySources}</h3>
      <ul>
        {documents.map((p) => (
          <li key={p.documentId}>
            <button type="button" className="link" onClick={() => onOpenSource(p.id)}>
              {p.documentTitle}
            </button>
            {p.languageLabel !== undefined && <span className="badge">{p.languageLabel}</span>}
            {retractionOf(p.documentId) !== undefined && confirming !== p.documentId && (
              <button type="button" className="link" onClick={() => (setConfirming(p.documentId), setError(null))}>
                {s.graphRetract}
              </button>
            )}
            {confirming === p.documentId && confirmBox(retractionOf(p.documentId)!)}
          </li>
        ))}
      </ul>
    </section>
  );
}
