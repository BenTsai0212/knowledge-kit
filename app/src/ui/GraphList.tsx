import { Fragment, useEffect, useRef } from "react";
import { clientConfig } from "../client/load";
import { strings } from "../client/i18n";
import { EntityIcon } from "./EntityIcon";
import { listAnchor, type ListGroup } from "./graph-list";

interface Props {
  groups: ListGroup[];
  language: string;
  // 目前的實體（選取的實體，沒有選取時是鍵盤的「目前」）：標上 aria-current，切到清單時捲到它
  current: string | null;
  onSelect(entityId: string): void;
}

const { entityTypes } = clientConfig.knowledgeModel;

// 清單模式（#289）：群組是 h3，實體是清單項目（名稱是按鈕，打開實體面板），關係是句子，句中的實體名稱是連結、跳到清單中的那一項
export function GraphList({ groups, language, current, onSelect }: Props) {
  const s = strings(language).graphKeyboard;
  const root = useRef<HTMLDivElement>(null);
  // 目前的實體改變（搜尋、切到清單）時捲到它；焦點不移動
  useEffect(() => {
    if (current !== null) document.getElementById(listAnchor(current))?.scrollIntoView({ block: "nearest" });
  }, [current]);
  // 關係句的連結：跳到清單中的那一項，焦點移到它的名稱按鈕（按 Enter 打開實體面板）
  const jump = (entityId: string) => {
    const target = root.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(listAnchor(entityId))} > .graph-list-name`);
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  };

  if (groups.length === 0) return <p className="muted graph-list">{s.listEmpty}</p>;
  return (
    <div className="graph-list" ref={root} aria-label={s.listLabel} role="region">
      {groups.map((g) => {
        const type = entityTypes.find((t) => t.id === g.type);
        return (
          <section key={g.type}>
            <h3>
              {type !== undefined && <EntityIcon icon={type.icon} color={type.color} />}
              {g.label}
            </h3>
            <ul>
              {g.entities.map(({ entity, label, sentences }) => (
                <li key={entity.id} id={listAnchor(entity.id)} aria-current={entity.id === current ? "true" : undefined}>
                  <button type="button" className="link graph-list-name" onClick={() => onSelect(entity.id)}>
                    {label}
                  </button>
                  {sentences.length > 0 && (
                    <ul className="graph-list-relations">
                      {sentences.map((parts, i) => (
                        <li key={i}>
                          {parts.map((p, j) =>
                            // 主詞或受詞是這一項自己時不做連結
                            p.entityId === undefined || p.entityId === entity.id ? (
                              <Fragment key={j}>{p.text}</Fragment>
                            ) : (
                              <a
                                key={j}
                                href={`#${listAnchor(p.entityId)}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  jump(p.entityId!);
                                }}
                              >
                                {p.text}
                              </a>
                            ),
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
