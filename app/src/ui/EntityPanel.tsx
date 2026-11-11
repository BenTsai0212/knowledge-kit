import { Fragment, useState, type CSSProperties } from "react";
import { clientConfig } from "../client/load";
import type { DocumentRetraction } from "../extraction/store";
import type { Graph } from "../graph/read";
import { relationCounts } from "../graph/search";
import { entityDocuments, entityOptionLabel, entityTypeLabel, relatedEntities, relationTypeLabel, sourcesForLanguage } from "./graph-labels";
import { entityTypeShape } from "./timeline-view";
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
  // 撤回此文件對這個實體的核准（含連帶的關係）；失敗時回傳錯誤訊息
  onRetract(retraction: DocumentRetraction): Promise<string | null>;
}

// 圖譜頁右側的實體面板（#199，設計系統 v1 #240）：類型徽章（類型色淡底＋形狀）、名稱、關聯／文件／出處數；
// 在問答中問（主要按鈕）、只看它（次要按鈕）；關係清單（方向、關係名稱、對方、出處數，點對方從它展開）；
// 出現的文件：每份文件一張 reading 紙面，列出提到它的原文片段並以 <mark> 標出名稱（點標題打開原文）。全部只用可見圖。
// 經審核進來的文件可以「撤回此文件對它的核准」：先列出撤回後會從圖譜消失的實體與關係，確認後才撤回（ADR 0007）。
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
  // 出處依文件分組，點標題打開第一段；出處優先顯示介面語言（#36）
  const documents = entityDocuments(entity, language);

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
      <span className={`entity-badge shape-${entityTypeShape(entity.type)}`} style={{ "--type-color": type?.color ?? "var(--color-graphFallback)" } as CSSProperties}>
        <span className="type-dot" aria-hidden="true" />
        {entityTypeLabel(entity.type, language)}
      </span>
      <h2>{name}</h2>
      <p className="entity-counts muted">
        {fill(s.graphRelationCount, { count: relationCounts(graph).get(entityId) ?? 0 })}
        {" · "}
        {fill(s.graphDocumentCount, { count: documents.length })}
        {" · "}
        {fill(s.graphSourceCount, { count: sourcesForLanguage(entity.sources, language).length })}
      </p>
      <div className="entity-actions">
        <button type="button" onClick={() => onAskAbout(entityId)}>
          {s.graphAskAbout}
        </button>
        <button type="button" className="secondary" onClick={() => onShowOnly(entityId)}>
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
      <ul className="entity-documents">
        {documents.map((d) => (
          <li key={d.documentId} className="entity-document">
            <button type="button" className="link" onClick={() => onOpenSource(d.passages[0].id)}>
              {d.documentTitle}
            </button>
            {d.languageLabel !== undefined && <span className="badge">{d.languageLabel}</span>}
            {retractionOf(d.documentId) !== undefined && confirming !== d.documentId && (
              <button type="button" className="chip retract" onClick={() => (setConfirming(d.documentId), setError(null))}>
                {s.graphRetract}
              </button>
            )}
            {confirming === d.documentId && confirmBox(retractionOf(d.documentId)!)}
            {d.passages.map((p) => (
              <p key={p.id} className="entity-excerpt">
                {p.segments.map((seg, i) => (seg.mark ? <mark key={i}>{seg.text}</mark> : <Fragment key={i}>{seg.text}</Fragment>))}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
