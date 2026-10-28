import type { PathStep } from "../graph/path";
import type { Graph } from "../graph/read";
import { entityName, entityOptionLabel, relationTypeLabel, sourcesForLanguage } from "./graph-labels";
import { strings } from "./strings";

interface Props {
  graph: Graph;
  language: string;
  from: string | null;
  to: string | null;
  // from、to 都選了才有值；找不到時為 null
  path: PathStep[] | null;
  onChange(from: string | null, to: string | null): void;
  onOpenSource(passageId: string): void;
}

// 多跳路徑：選兩個實體，逐步列出路徑上的關係與出處；找不到時顯示固定文字，不透露原因
export function PathPanel({ graph, language, from, to, path, onChange, onOpenSource }: Props) {
  const s = strings(language);
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const relations = new Map(graph.relations.map((r) => [r.id, r]));
  const options = graph.entities
    .map((e) => ({ id: e.id, label: entityOptionLabel(graph, e, language) }))
    .sort((a, b) => a.label.localeCompare(b.label, language));
  const select = (value: string | null, onSelect: (id: string | null) => void, label: string) => (
    <label>
      {label}
      <select value={value ?? ""} onChange={(e) => onSelect(e.target.value === "" ? null : e.target.value)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="card path">
      <h2>{s.pathTitle}</h2>
      <div className="path-select">
        {select(from, (id) => onChange(id, to), s.pathFrom)}
        {select(to, (id) => onChange(from, id), s.pathTo)}
      </div>
      {from === null || to === null ? (
        <p className="muted">{s.pathChoose}</p>
      ) : path === null ? (
        <p>{s.pathNotFound}</p>
      ) : (
        <ol>
          {path.map((step, i) => {
            const relation = step.relation === undefined ? undefined : relations.get(step.relation);
            return (
              <li key={i}>
                {relation !== undefined && (
                  <div className="muted">
                    {relationTypeLabel(relation.type, language)}
                    {s.colon}
                    {entityName(byId.get(relation.from)!, language)} → {entityName(byId.get(relation.to)!, language)}
                    <ul>
                      {sourcesForLanguage(relation.sources, language).map((p) => (
                        <li key={p.id}>
                          {p.documentTitle}
                          {s.colon}
                          {p.languageLabel !== undefined && <span className="badge">{p.languageLabel}</span>} <span lang={p.language}>{p.content}</span>{" "}
                          <button type="button" className="link" onClick={() => onOpenSource(p.id)}>
                            {s.openSource}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <strong>{entityName(byId.get(step.entity)!, language)}</strong>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
