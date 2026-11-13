// 以名稱搜尋實體（#199）：圖譜上方的搜尋框，以及多跳路徑的起點與終點。
// 只在傳入的可見圖中搜尋（graph/search.ts），所以只會列出目前身分看得到的實體。鍵盤可操作（combobox＋listbox）
import { useId, useState, type KeyboardEvent } from "react";
import { clientConfig } from "../client/load";
import type { Graph } from "../graph/read";
import { searchEntities } from "../graph/search";
import { strings } from "../client/i18n";
import { EntityIcon } from "./EntityIcon";
import { entityOptionLabel, entityTypeLabel } from "./graph-labels";

const { entityTypes } = clientConfig.knowledgeModel;

interface Props {
  graph: Graph;
  language: string;
  label: string;
  // 類型篩選（沒勾的類型不列出）；null 時全選
  types?: ReadonlySet<string> | null;
  // 目前選定的實體（多跳路徑的兩端）：沒有輸入時顯示它的名稱
  value?: string | null;
  onPick(entityId: string): void;
  // 清空輸入框時（多跳路徑的兩端）
  onClear?(): void;
  // 桌機的圖譜頁首（#336，畫板 Graph）：標籤只給報讀器，輸入框前有搜尋 icon，placeholder 是標籤
  field?: boolean;
}

export function EntitySearch({ graph, language, label, types = null, value = null, onPick, onClear, field = false }: Props) {
  const s = strings(language);
  const id = useId();
  // null＝沒有在輸入，顯示選定實體的名稱
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = value === null ? undefined : graph.entities.find((e) => e.id === value);
  const text = query ?? (selected === undefined ? "" : entityOptionLabel(graph, selected, language));
  const results = query === null ? [] : searchEntities(graph, query, language, entityTypes, types);
  const expanded = open && query !== null && query.trim() !== "";

  const pick = (entityId: string) => {
    onPick(entityId);
    setQuery(null);
    setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (results.length > 0) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
    } else if (e.key === "Enter" && expanded && results[active] !== undefined) {
      e.preventDefault();
      pick(results[active].id);
    } else if (e.key === "Escape") {
      setQuery(null);
      setOpen(false);
    }
  };

  return (
    <div className={field ? "entity-search entity-search--field" : "entity-search"}>
      <label htmlFor={`${id}-input`} className={field ? "visually-hidden" : undefined}>
        {label}
      </label>
      {field && (
        <svg className="entity-search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      )}
      <input
        placeholder={field ? label : undefined}
        id={`${id}-input`}
        type="search"
        role="combobox"
        autoComplete="off"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={expanded && results[active] !== undefined ? `${id}-${active}` : undefined}
        value={text}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          if (e.target.value === "") onClear?.();
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <ul id={`${id}-list`} role="listbox" aria-label={label} hidden={!expanded || results.length === 0}>
        {expanded &&
          results.map((e, i) => {
            const type = entityTypes.find((t) => t.id === e.type);
            return (
              <li
                key={e.id}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
                // 在輸入框失去焦點之前選取
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(e.id);
                }}
              >
                {type !== undefined && <EntityIcon icon={type.icon} color={type.color} />}
                {entityOptionLabel(graph, e, language)} <span className="muted">{entityTypeLabel(e.type, language)}</span>
              </li>
            );
          })}
      </ul>
      {expanded && results.length === 0 && (
        <p className="muted entity-search-none" role="status">
          {s.graphSearchNone}
        </p>
      )}
    </div>
  );
}
