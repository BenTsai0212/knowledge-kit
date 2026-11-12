import { useEffect, useMemo, useRef, useState } from "react";
import { clientConfig } from "../client/load";
import type { Database } from "../db/database";
import { readRetractions, retract, ReviewError, type DocumentRetraction } from "../extraction/store";
import { ALL, expand, keepVisible as keepVisiblePath, only, selectedOf, type Expansion } from "../graph/expansion";
import { shortestPath } from "../graph/path";
import { readGraph, type Graph } from "../graph/read";
import { excludedEntities, topConnected } from "../graph/search";
import { focusIdentity } from "./empty-state";
import { EmptyState } from "./EmptyState";
import { EntityIcon } from "./EntityIcon";
import { EntityPanel } from "./EntityPanel";
import { EntitySearch } from "./EntitySearch";
import { entityOptionLabel } from "./graph-labels";
import { GraphView } from "./GraphView";
import { PathPanel } from "./PathPanel";
import { createRequestGate } from "./requests";
import { fill, strings } from "../client/i18n";

interface Props {
  db: Database;
  identity: string;
  language: string;
  onOpenSource(passageId: string): void;
  // 在問答中問（#199）：把問句填進問答頁的輸入框並切到問答頁，不送出
  onAskAbout(question: string): void;
  // 能審核的身分可以從實體面板撤回文件的核准（ADR 0007）；撤回後通知 App 更新待審筆數
  canReview: boolean;
  onRetracted(): void;
  // 從問答頁的「在圖譜中查看」打開時，從該實體開始展開（#195、#199）；看不到時顯示全部
  initialSelected?: string | null;
  // 帳號登入時身分固定（#287）：空狀態不給「切換身分」
  canSwitchIdentity: boolean;
  // 選取的實體（首頁的「最近看過」，#283）；只在圖譜讀到、目前身分看得到時通知
  onViewed?(entityId: string): void;
}

const { entityTypes } = clientConfig.knowledgeModel;

// 新的圖譜中已看不到的實體一律清除
const keepVisible = (graph: Graph) => (id: string | null) => (id !== null && graph.entities.some((e) => e.id === id) ? id : null);

// 圖譜頁：切換身分或語言時重新讀取；之後才回來的舊結果忽略；已展開的路徑截到第一個看不到的實體之前，路徑的兩端已看不到時清除。
// 逐步展開（#199）：點節點從它展開，已展開的路徑累積；「回到全部」顯示全貌。
// 中間是搜尋框、類型篩選（圖例）與圖，右側是實體面板（沒有選取時列出關聯最多的實體當起點）與多跳路徑
export function GraphPage({ db, identity, language, onOpenSource, onAskAbout, canReview, onRetracted, initialSelected = null, canSwitchIdentity, onViewed }: Props) {
  const s = strings(language);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [expansion, setExpansionState] = useState<Expansion>(initialSelected === null ? ALL : only(initialSelected));
  // 最後一次操作是按「只看它」時，變灰的元素降到 15%；之後再展開、點節點或搜尋回到 45%（#240 決定 1）
  const [isolated, setIsolated] = useState(false);
  const setExpansion = (next: Expansion | ((current: Expansion) => Expansion), isolate = false) => {
    setExpansionState(next);
    setIsolated(isolate);
  };
  const [ends, setEnds] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  // 類型篩選：勾選的類型（預設全選）
  const [types, setTypes] = useState<ReadonlySet<string>>(() => new Set(entityTypes.map((t) => t.id)));
  const reads = useRef(createRequestGate());
  // 撤回後重新讀取圖譜
  const [version, setVersion] = useState(0);
  // 選取的實體可以撤回的文件（沒有 canReview 時不讀取）
  const [retractions, setRetractions] = useState<{ entityId: string; list: DocumentRetraction[] } | null>(null);

  useEffect(() => {
    const ticket = reads.current.begin();
    setGraph(null);
    void readGraph(db, identity).then((g) => {
      if (!ticket.isCurrent()) return;
      const keep = keepVisible(g);
      setGraph(g);
      // 切換身分時只截掉看不到的部分，「只看它」的狀態不變
      setExpansionState((current) => keepVisiblePath(g, current));
      setEnds(({ from, to }) => ({ from: keep(from), to: keep(to) }));
    });
    return () => reads.current.cancel();
  }, [db, identity, language, version]);

  const selected = selectedOf(expansion);
  useEffect(() => {
    if (!canReview || selected === null || graph === null) return;
    let cancelled = false;
    void readRetractions(db, identity, selected).then((list) => {
      if (!cancelled) setRetractions({ entityId: selected, list });
    });
    return () => {
      cancelled = true;
    };
  }, [db, identity, canReview, selected, graph]);
  const visibleSelected = graph !== null && graph.entities.some((e) => e.id === selected) ? selected : null;
  useEffect(() => {
    if (visibleSelected !== null) onViewed?.(visibleSelected);
    // onViewed 每次 render 都是新的函式；只在選取改變時通知
  }, [visibleSelected]);
  // 多跳路徑的起點預設為目前選取的實體
  const from = ends.from ?? selected;
  // 路徑由目前的可見圖算出，切換身分後一律重新計算
  const path = useMemo(
    () => (graph === null || from === null || ends.to === null ? null : shortestPath(graph, from, ends.to)),
    [graph, from, ends.to],
  );
  // 只有 knowledge-model.json 中的類型可以篩選；其他類型（例如之後萃取的）一律保留
  const filter = useMemo(() => {
    const unknown = (graph?.entities ?? []).map((e) => e.type).filter((t) => !entityTypes.some((x) => x.id === t));
    return new Set([...types, ...unknown]);
  }, [graph, types]);
  const excluded = useMemo(() => (graph === null ? new Set<string>() : excludedEntities(graph, filter)), [graph, filter]);

  if (graph === null) return <p className="card muted">{s.loading}</p>;
  // 原因只說明目前身分的資料，不暗示有看不到的實體；切換身分旁不說明會多看到什麼（#245 決定）
  if (graph.entities.length === 0)
    return <EmptyState icon="graph" title={s.graphEmpty} reason={s.graphEmptyReason} actions={canSwitchIdentity ? [{ label: s.switchIdentity, onClick: focusIdentity }] : []} />;

  const onExpand = (id: string) => setExpansion((current) => expand(graph, current, id));
  // 與搜尋結果、節點標籤相同：同名的實體加上第一個相關實體的名稱（#198）
  const nameOf = (id: string) => {
    const entity = graph.entities.find((e) => e.id === id);
    return entity === undefined ? id : entityOptionLabel(graph, entity, language);
  };
  const toggleType = (id: string) =>
    setTypes((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const top = topConnected(graph, language, filter);

  return (
    <div className="graph-page">
      <section className="card graph-main">
        <div className="graph-tools">
          <EntitySearch graph={graph} language={language} label={s.graphSearch} types={filter} onPick={(id) => setExpansion(only(id))} />
          {/* 圖例兼類型篩選：沒勾的類型變灰，並排除在搜尋與起點清單外 */}
          <ul className="legend" aria-label={s.legend}>
            {entityTypes.map((t) => (
              <li key={t.id}>
                <label>
                  <input type="checkbox" checked={types.has(t.id)} onChange={() => toggleType(t.id)} />
                  <EntityIcon icon={t.icon} color={t.color} />
                  {t.label[language]}
                </label>
              </li>
            ))}
          </ul>
        </div>
        {/* 這一列沒有展開時也保留高度：出現或消失時畫布不移動 */}
        <div className="graph-trail">
          {expansion.length > 0 && (
            <nav aria-label={s.graphExpanded}>
              <span className="muted">
                {s.graphExpanded}
                {s.colon}
              </span>
              <ol>
                {expansion.map((id, i) => (
                  <li key={id}>
                    {/* 點其中一段：回到該層 */}
                    <button
                      type="button"
                      className="link"
                      aria-current={i === expansion.length - 1 ? "step" : undefined}
                      onClick={() => setExpansion(expansion.slice(0, i + 1))}
                    >
                      {nameOf(id)}
                    </button>
                  </li>
                ))}
              </ol>
              <button type="button" onClick={() => setExpansion(ALL)}>
                {s.graphShowAll}
              </button>
            </nav>
          )}
        </div>
        <GraphView graph={graph} language={language} selected={selected} path={path} expansion={expansion} excluded={excluded} isolated={isolated} onSelect={onExpand} />
      </section>
      <div className="graph-side">
        {selected === null ? (
          <section className="card graph-start" aria-label={s.graphTopConnected}>
            <p className="muted">{s.selectEntity}</p>
            <h2>{s.graphTopConnected}</h2>
            <ol>
              {top.map(({ entity, count }) => {
                const type = entityTypes.find((t) => t.id === entity.type);
                return (
                  <li key={entity.id}>
                    <button type="button" className="link" onClick={() => setExpansion(only(entity.id))}>
                      {type !== undefined && <EntityIcon icon={type.icon} color={type.color} />}
                      {entityOptionLabel(graph, entity, language)}
                    </button>{" "}
                    <span className="muted">{fill(s.graphRelationCount, { count })}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : (
          <EntityPanel
            // 換選取的實體時清除撤回的確認
            key={selected}
            graph={graph}
            entityId={selected}
            language={language}
            onSelect={onExpand}
            onShowOnly={(id) => setExpansion(only(id), true)}
            onAskAbout={(id) => onAskAbout(fill(s.askAboutEntity, { name: nameOf(id) }))}
            onOpenSource={onOpenSource}
            retractions={canReview && retractions?.entityId === selected ? retractions.list : []}
            onRetract={async (r) => {
              try {
                await retract(db, identity, r.decisionIds);
              } catch (e) {
                return e instanceof ReviewError ? s.reviewErrors[e.reason] : s.unknownError;
              }
              setVersion((v) => v + 1);
              onRetracted();
              return null;
            }}
          />
        )}
        <PathPanel
          graph={graph}
          language={language}
          from={from}
          to={ends.to}
          path={path}
          // 起點沒改時保留「預設為選取的實體」，之後選取別的實體時起點跟著改
          onChange={(nextFrom, to) => setEnds({ from: nextFrom === from ? ends.from : nextFrom, to })}
          onOpenSource={onOpenSource}
        />
      </div>
    </div>
  );
}
