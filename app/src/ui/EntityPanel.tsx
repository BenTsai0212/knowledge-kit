import type { Graph } from "../graph/read";
import { entityName, entityTypeLabel, relatedEntities, sourcesForLanguage } from "./graph-labels";
import { strings } from "../client/i18n";

interface Props {
  graph: Graph;
  entityId: string;
  language: string;
  onSelect(entityId: string): void;
  onOpenSource(passageId: string): void;
}

// 點節點時顯示：類型、名稱、相關實體（可點）與出處段落（可打開原文）
export function EntityPanel({ graph, entityId, language, onSelect, onOpenSource }: Props) {
  const s = strings(language);
  const entity = graph.entities.find((e) => e.id === entityId);
  if (entity === undefined) return null;
  const name = entityName(entity, language);

  return (
    <section className="card entity" aria-label={name}>
      <h2>
        {name} <span className="badge">{entityTypeLabel(entity.type, language)}</span>
      </h2>
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
      <h3>{s.entitySources}</h3>
      <ul>
        {sourcesForLanguage(entity.sources, language).map((p) => (
          <li key={p.id}>
            <span className="muted">
              {p.documentTitle}
              {s.colon}
            </span>
            {p.languageLabel !== undefined && <span className="badge">{p.languageLabel}</span>} <span lang={p.language}>{p.content}</span>{" "}
            <button type="button" className="link" onClick={() => onOpenSource(p.id)}>
              {s.openSource}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
