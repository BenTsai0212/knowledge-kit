import { useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { clientConfig } from "../client/load";
import type { Database } from "../db/database";
import { readRetractions, retract, ReviewError, type DocumentRetraction } from "../extraction/store";
import { ALL, expand, keepVisible as keepVisiblePath, only, selectedOf, type Expansion } from "../graph/expansion";
import { shortestPath } from "../graph/path";
import { clusterGraph, filterGraph, scaleMode } from "../graph/clusters";
import { readGraph, type Graph } from "../graph/read";
import { topConnected } from "../graph/search";
import { focusIdentity } from "./empty-state";
import { EmptyState } from "./EmptyState";
import { EntityIcon } from "./EntityIcon";
import { EntityPanel } from "./EntityPanel";
import { EntitySearch } from "./EntitySearch";
import { GraphList } from "./GraphList";
import { listedEntities, listGroups, loadGraphMode, saveGraphMode, type GraphMode } from "./graph-list";
import { entityOptionLabel } from "./graph-labels";
import { closeDialog } from "./dialog-motion";
import {
  announceEnter,
  announceGo,
  announceMove,
  announceShown,
  backStep,
  createAnnouncer,
  entryEntity,
  keyAction,
  KEY_HELP,
  moveCursor,
  neighborsClockwise,
  toggleOnly,
  ZOOM_STEP,
} from "./graph-keyboard";
import { GraphView, type GraphViewApi } from "./GraphView";
import { breadcrumb, detailOf, zoomLevel } from "./graph-zoom";
import { GraphZoomView } from "./GraphZoomView";
import { prefersReducedMotion } from "./motion";
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

// 手機（≤ 600px）用較低的門檻（docs/design.md「大量節點時的圖譜」）
const MOBILE = "(max-width: 600px)";

function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => globalThis.matchMedia?.(MOBILE).matches ?? false);
  useEffect(() => {
    const query = globalThis.matchMedia?.(MOBILE);
    if (query === undefined) return;
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 在「回到全部」的狀態按 Esc 離開圖譜（#289 決定 4）：焦點移到外框後的下一個可聚焦元素，等同 Tab
function focusAfter(element: HTMLElement) {
  const next = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
    (el) => !element.contains(el) && el.getClientRects().length > 0 && (element.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  next?.focus();
}

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
  // 大量節點時（#254）：「只顯示關聯 ≥ N」、展開的群組、細節層是否展開群內全部成員（#254 決定 3）
  const [minRelations, setMinRelations] = useState(0);
  const [cluster, setCluster] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const mobile = useMobile();
  const reads = useRef(createRequestGate());
  // 撤回後重新讀取圖譜
  const [version, setVersion] = useState(0);
  // 選取的實體可以撤回的文件（沒有 canReview 時不讀取）
  const [retractions, setRetractions] = useState<{ entityId: string; list: DocumentRetraction[] } | null>(null);
  // 鍵盤操作（#289）：沒有選取時鍵盤的「目前」只畫圈、報讀，按 Enter 前不展開、不改實體面板（#289 決定 2）；
  // 有選取時目前的實體就是選取的實體。游標是目前實體的某個相關實體；focused＝外框有鍵盤焦點（:focus-visible）
  const [keyboardCurrent, setKeyboardCurrent] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const announcer = useMemo(() => createAnnouncer(setAnnouncement), []);
  useEffect(() => {
    return announcer.cancel;
  }, [announcer]);
  const view = useRef<GraphViewApi | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const help = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLDivElement>(null);
  // Space 之前的展開（再按一次 Space 時回到這裡）
  const beforeOnly = useRef<Expansion | null>(null);
  // 用 / 跳到搜尋框時，選了結果後焦點回到外框（#289）；在 render 之後才移動焦點，讓進入時讀到新的選取
  const searchFromFrame = useRef(false);
  const [refocus, setRefocus] = useState(0);
  // 關閉按鍵表（?）後回到外框：保留目前的實體與游標，不重新報讀進入
  const resume = useRef(false);
  useEffect(() => {
    if (refocus > 0) frame.current?.focus();
  }, [refocus]);
  // 「圖譜｜清單」（#289）：一直都在，選擇記在這個瀏覽器；篩選、搜尋、「只看它」與目前的實體兩種檢視共用
  const [mode, setModeState] = useState<GraphMode>(() => loadGraphMode());
  const setMode = (next: GraphMode) => {
    setModeState(next);
    saveGraphMode(next);
  };

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
      setKeyboardCurrent(keep);
      setCursor(keep);
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
  // 類型篩選與「只顯示關聯 ≥ N」後的圖：門檻以它的實體數重新計算；門檻以下時篩掉的實體變灰（excluded），以上時以它分群
  const filtered = useMemo(() => (graph === null ? null : filterGraph(graph, { types: filter, minRelations })), [graph, filter, minRelations]);
  const excluded = useMemo(() => {
    const kept = new Set(filtered?.entities.map((e) => e.id));
    return new Set((graph?.entities ?? []).map((e) => e.id).filter((id) => !kept.has(id)));
  }, [graph, filtered]);
  const clustering = useMemo(
    () => (filtered === null || scaleMode(filtered.entities.length, mobile) === "all" ? null : clusterGraph(filtered, clientConfig.knowledgeModel)),
    [filtered, mobile],
  );
  // 清單的群組（#254 決定 5）：門檻以上沿用全覽的分群，門檻以下也用同一種分群（篩選後的圖），不再依實體類型
  const groups = useMemo(() => {
    if (graph === null || filtered === null || mode !== "list") return [];
    const listClustering = clustering ?? clusterGraph(filtered, clientConfig.knowledgeModel);
    return listGroups(graph, listClustering, listedEntities(graph, excluded, expansion, isolated), excluded, language);
  }, [graph, filtered, clustering, mode, excluded, expansion, isolated, language]);
  // 選取改變時（點節點、搜尋、面板）游標清除，細節層的成員收回
  useEffect(() => {
    setCursor(null);
    setShowMembers(false);
  }, [selected]);
  const zoom = clustering === null ? null : zoomLevel(clustering, cluster, selected);
  // 進入細節層時記住所屬的群組：返回（麵包屑、Esc）時回到群組層
  useEffect(() => {
    if (zoom?.level === "detail") setCluster(zoom.cluster);
  }, [zoom?.level, zoom?.cluster]);
  // 篩選後報讀顯示的實體數（只在勾選改變時）
  const announcedTypes = useRef(types);
  useEffect(() => {
    if (graph !== null && announcedTypes.current !== types) announcer.say(announceShown(graph, excluded, language));
    announcedTypes.current = types;
  }, [types]);

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
  const z = s.graphZoom;
  const openCluster = (id: string | null) => {
    setCluster(id);
    setExpansion(ALL);
  };
  const clusterName = (id: string) => {
    const c = clustering?.clusters.find((x) => x.id === id);
    return c === undefined || c.anchor === null ? z.other : nameOf(c.anchor);
  };
  const zoomCluster = clustering?.clusters.find((c) => c.id === zoom?.cluster);
  const collapsed =
    zoom?.level === "detail" && zoomCluster !== undefined && selected !== null && filtered !== null ? detailOf(filtered, zoomCluster, selected).collapsed.length : 0;

  // 鍵盤操作（#289）：外框取得鍵盤焦點時，目前的實體＝選取的實體，沒有選取時是關聯最多的實體（只畫圈，不展開）
  const k = s.graphKeyboard;
  const current = selected ?? keyboardCurrent;
  const enter = () => {
    const entry = entryEntity(graph, selected, excluded, language);
    if (selected === null) setKeyboardCurrent(entry);
    setCursor(null);
    setFocused(true);
    announcer.say(announceEnter(graph, entry, excluded, language));
    return entry;
  };
  const onFrameFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    // 只處理鍵盤進入外框；用滑鼠點畫布時不畫圈、不報讀，之後按鍵時才進入
    if (e.target !== e.currentTarget) return;
    if (resume.current) {
      resume.current = false;
      setFocused(true);
    } else if (e.currentTarget.matches(":focus-visible")) enter();
  };
  const onFrameKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const action = keyAction(e);
    if (action === null) return;
    e.preventDefault();
    if (action === "zoomIn" || action === "zoomOut") return view.current?.zoomBy(action === "zoomIn" ? ZOOM_STEP : 1 / ZOOM_STEP);
    if (action === "fit") return view.current?.fit();
    if (action === "help") {
      // 關閉時瀏覽器把焦點還給外框（之後 onClose 再確保一次）：先記下，回來時不重新進入
      resume.current = true;
      return help.current?.showModal();
    }
    if (action === "search") {
      searchFromFrame.current = true;
      return search.current?.querySelector("input")?.focus();
    }
    const at = focused && current !== null ? current : enter();
    if (at === null) return;
    if (action === "prev" || action === "next") {
      const neighbors = neighborsClockwise(graph, at, view.current?.positions() ?? new Map(), excluded);
      const index = moveCursor(neighbors.length, cursor === null ? null : neighbors.findIndex((n) => n.entity.id === cursor), action === "next" ? 1 : -1);
      if (index === null) return announcer.say(k.noNeighbors);
      setCursor(neighbors[index].entity.id);
      announcer.say(announceMove(graph, neighbors, index, language));
    } else if (action === "go") {
      // 前往游標所在的實體（沒有游標時是目前的實體）：等同點節點，實體面板同步，焦點留在外框
      const target = cursor ?? at;
      onExpand(target);
      setKeyboardCurrent(target);
      setCursor(null);
      announcer.say(announceGo(graph, target, language));
    } else if (action === "back") {
      // 上一個實體＝展開路徑的上一段，與麵包屑一致（#289 決定 3）；只有一層時回到全部，目前的實體保留在鍵盤的「目前」
      const previous = backStep(expansion);
      if (previous === null) return announcer.say(k.atStart);
      setExpansion(previous);
      setCursor(null);
      const target = previous.at(-1);
      if (target === undefined) {
        setKeyboardCurrent(at);
        announcer.say(announceShown(graph, excluded, language));
      } else {
        setKeyboardCurrent(target);
        announcer.say(announceGo(graph, target, language));
      }
    } else if (action === "only") {
      const next = toggleOnly(graph, { expansion, isolated, saved: beforeOnly.current }, at);
      beforeOnly.current = next.saved;
      setExpansion(next.expansion, next.isolated);
      setKeyboardCurrent(at);
      announcer.say(fill(next.on ? k.onlyOn : k.onlyOff, { name: nameOf(at) }));
    } else if (action === "ask") {
      onAskAbout(fill(s.askAboutEntity, { name: nameOf(at) }));
    } else if (expansion.length > 0) {
      // Esc：回到全部，目前的實體保留在鍵盤的「目前」
      setKeyboardCurrent(at);
      setExpansion(ALL);
      announcer.say(announceShown(graph, excluded, language));
    } else focusAfter(e.currentTarget);
  };

  return (
    <div className="graph-page">
      <section className="card graph-main">
        <div className="graph-tools">
          <div
            ref={search}
            className="graph-search"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) searchFromFrame.current = false;
            }}
          >
            <EntitySearch
              graph={graph}
              language={language}
              label={s.graphSearch}
              types={filter}
              onPick={(id) => {
                setExpansion(only(id));
                if (searchFromFrame.current) setRefocus((n) => n + 1);
                searchFromFrame.current = false;
              }}
            />
          </div>
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
          <label className="graph-min">
            {z.minRelations}
            <input type="number" min={0} value={minRelations} onChange={(e) => setMinRelations(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
          </label>
          <div className="graph-mode" role="group" aria-label={k.modeLabel}>
            {(["graph", "list"] as const).map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === "graph" ? k.modeGraph : k.modeList}
              </button>
            ))}
          </div>
        </div>
        {/* 這一列沒有展開時也保留高度：出現或消失時畫布不移動 */}
        <div className="graph-trail">
          {zoom !== null && (
            <nav aria-label={z.breadcrumb} className="graph-crumbs">
              <ol>
                {breadcrumb(zoom.level, zoom.cluster, selected).map((c, i, all) => (
                  <li key={c.kind}>
                    <button
                      type="button"
                      className="link"
                      aria-current={i === all.length - 1 ? "step" : undefined}
                      onClick={() => (c.kind === "entity" ? undefined : openCluster(c.id))}
                    >
                      {c.kind === "all" ? z.all : c.kind === "cluster" ? clusterName(c.id!) : nameOf(c.id!)}
                    </button>
                  </li>
                ))}
              </ol>
              {collapsed > 0 && !showMembers && (
                <button type="button" className="chip" onClick={() => setShowMembers(true)}>
                  {fill(z.moreMembers, { count: collapsed }, language)}
                </button>
              )}
            </nav>
          )}
          {zoom === null && expansion.length > 0 && (
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
        {mode === "list" ? (
          <GraphList groups={groups} language={language} current={current} onSelect={onExpand} />
        ) : (
          <>
            {/* 外框（#289）：在 Tab 順序中只佔一個位置，方向鍵交給圖譜；畫布本身對報讀器隱藏，每一步寫進報讀區 */}
            <div
              className="graph-frame"
              tabIndex={0}
              role="application"
              aria-roledescription={k.roleDescription}
              aria-label={k.label}
              onFocus={onFrameFocus}
              onBlur={(e) => {
                if (e.target === e.currentTarget) setFocused(false);
              }}
              onKeyDown={onFrameKeyDown}
              ref={frame}
            >
              {zoom !== null && clustering !== null && filtered !== null ? (
                <GraphZoomView
                  graph={filtered}
                  clustering={clustering}
                  level={zoom.level}
                  cluster={zoom.cluster}
                  selected={zoom.level === "detail" ? selected : null}
                  showMembers={showMembers}
                  language={language}
                  clusterName={clusterName}
                  segments={(count) => fill(z.segments, { count }, language)}
                  onSelect={onExpand}
                  onOpenCluster={openCluster}
                  keyboard={focused ? { current, cursor } : null}
                  api={view}
                />
              ) : (
                <GraphView
                  graph={graph}
                  language={language}
                  selected={selected}
                  path={path}
                  expansion={expansion}
                  excluded={excluded}
                  isolated={isolated}
                  onSelect={onExpand}
                  keyboard={focused ? { current, cursor } : null}
                  api={view}
                />
              )}
            </div>
            {/* 按鍵提示列：只在外框有鍵盤焦點（:focus-visible）時出現（app.css）；報讀器從按鍵表（?）讀，這裡不重複 */}
            <ul className="graph-keys" aria-hidden="true">
              {KEY_HELP.filter((h) => h.hint).map((h) => (
                <li key={h.text}>
                  {h.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}{" "}
                  {k[h.text]}
                </li>
              ))}
            </ul>
            {/* 按鍵表（?）：沿用置中的對話框；Esc 或「關閉」播放退場後關閉，焦點回到外框 */}
            <dialog
              ref={help}
              className="dialog graph-help"
              aria-labelledby="graph-help-title"
              onCancel={(e) => (e.preventDefault(), closeDialog(e.currentTarget, prefersReducedMotion()))}
              onClose={() => frame.current?.focus()}
            >
              <h2 id="graph-help-title">{k.helpTitle}</h2>
              <dl>
                {KEY_HELP.map((h) => (
                  <div key={h.text}>
                    <dt>
                      {h.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </dt>
                    <dd>{k[h.text]}</dd>
                  </div>
                ))}
              </dl>
              <div className="dialog-actions">
                <button type="button" onClick={() => help.current !== null && closeDialog(help.current, prefersReducedMotion())}>
                  {s.dialogClose}
                </button>
              </div>
            </dialog>
          </>
        )}
        {/* 報讀區：兩種檢視共用（類型篩選改變時報讀顯示的實體數） */}
        <p className="visually-hidden" aria-live="polite" data-testid="graph-announcer">
          {announcement}
        </p>
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
