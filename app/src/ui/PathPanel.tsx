import { useRef } from "react";
import type { PathStep } from "../graph/path";
import type { Graph } from "../graph/read";
import { EmptyState } from "./EmptyState";
import { EntitySearch } from "./EntitySearch";
import { entityName, relationTypeLabel, sourcesForLanguage } from "./graph-labels";
import { strings } from "../client/i18n";

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

// 多跳路徑（#199：右側面板下方的可收合區塊，兩端用與搜尋框相同的元件）：逐步列出路徑上的關係與出處；找不到時顯示固定文字，不透露原因
export function PathPanel({ graph, language, from, to, path, onChange, onOpenSource }: Props) {
  const s = strings(language);
  const ends = useRef<HTMLDivElement>(null);
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const relations = new Map(graph.relations.map((r) => [r.id, r]));
  const end = (value: string | null, onSelect: (id: string | null) => void, label: string) => (
    <EntitySearch graph={graph} language={language} label={label} value={value} onPick={onSelect} onClear={() => onSelect(null)} />
  );

  return (
    <details className="card path">
      <summary>{s.pathTitle}</summary>
      <div ref={ends} className="path-select">
        {end(from, (id) => onChange(id, to), s.pathFrom)}
        {end(to, (id) => onChange(from, id), s.pathTo)}
      </div>
      {from === null || to === null ? (
        <p className="muted">{s.pathChoose}</p>
      ) : path === null ? (
        // 換一個終點：清除終點，焦點移到終點的搜尋框（#245）
        <EmptyState
          as="div"
          icon="path"
          title={s.pathNotFound}
          reason={s.pathNotFoundReason}
          actions={[
            {
              label: s.pathChangeEnd,
              onClick: () => {
                onChange(from, null);
                requestAnimationFrame(() => [...(ends.current?.querySelectorAll("input") ?? [])].at(-1)?.focus());
              },
            },
          ]}
        />
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
    </details>
  );
}
