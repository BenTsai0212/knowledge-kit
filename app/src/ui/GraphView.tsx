// 以 cytoscape 畫出圖譜。cytoscape 以動態 import 載入：只用問答的人不必下載（build 時分成獨立的 chunk）。
import type { CollectionReturnValue, Core, EdgeSingular, ElementDefinition } from "cytoscape";
import { useEffect, useRef, type RefObject } from "react";
import { clientConfig } from "../client/load";
import { ALL, focusOf, nearRelations, selectedOf, type Expansion } from "../graph/expansion";
import type { PathStep } from "../graph/path";
import type { Graph } from "../graph/read";
import { relationCounts } from "../graph/search";
import { clampLabel, nodeLabels, type MeasureText } from "./graph-labels";
import { edgeWidth, graphStyle, NODE_LABEL_FONT_SIZE, NODE_LABEL_MAX_LINES, NODE_LABEL_MAX_WIDTH, nodeSize } from "./graph-style";
import { visibleArea } from "./layout";
import { panToCenter } from "./graph-zoom";
import { EXPAND_MS, MOTION, motionDuration, PAN_MS, watchReducedMotion } from "./motion";
import { isDark, watchColorScheme } from "./theme";

interface Props {
  graph: Graph;
  language: string;
  selected: string | null;
  // 標示在圖上的路徑（多跳路徑）
  path: PathStep[] | null;
  onSelect(entityId: string): void;
  // 逐步展開（#199，圖譜頁）：聚焦集合以外的節點與線變灰；沒有傳入時不變灰（問答頁的鄰近圖）
  expansion?: Expansion;
  // 類型篩選（#199，圖譜頁）：沒勾的類型的實體與它們的線變灰
  excluded?: ReadonlySet<string>;
  // 最後一次操作是按「只看它」（#240 決定 1）：變灰的元素降到 15%（平常 45%）
  isolated?: boolean;
  // 右側實體面板的小型鄰近圖（#195）：高度較低
  compact?: boolean;
  // 判斷同名實體用的圖（#198）：鄰近圖傳入完整的可見圖；沒有傳入時用 graph
  labelGraph?: Graph;
  // 鍵盤操作（#289，圖譜頁）：目前的實體與游標；圖譜外框有鍵盤焦點時才傳入
  keyboard?: KeyboardMarks | null;
  // 鍵盤操作讀取節點位置（順時針排序用）
  api?: RefObject<GraphViewApi | null>;
  // 手機的實體面板蓋住視窗下方的比例（#257，停在 56% 時是 SHEET_HALF；沒有面板時 0）：選取的節點平移到面板以上的中央
  cover?: number;
}

export interface KeyboardMarks {
  current: string | null;
  cursor: string | null;
}

export interface GraphViewApi {
  // 節點在版面上的位置（model 座標，不受平移與縮放影響）；圖還沒畫好時是空的
  positions(): Map<string, { x: number; y: number }>;
  // 以畫面中心縮放（+／-）與全部顯示（0）；減少動態效果時直接到位
  zoomBy(factor: number): void;
  fit(): void;
}

const NONE: ReadonlySet<string> = new Set();

const { entityTypes, relationTypes } = clientConfig.knowledgeModel;

// 以節點標籤的字型量寬度（canvas 的 measureText，與 cytoscape 畫標籤的方式相同）；取不到 canvas 時每個字以 1em 估計（寧可多截斷）
export function labelMeasure(): MeasureText {
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim() || "sans-serif";
  const context = document.createElement("canvas").getContext?.("2d") ?? null;
  if (context === null) return (text) => [...text].length * NODE_LABEL_FONT_SIZE;
  context.font = `${NODE_LABEL_FONT_SIZE}px ${font}`;
  return (text) => context.measureText(text).width;
}

// 節點的類型（type）決定形狀、填色與圖示，找不到類型時由 graphStyle() 套用 graphFallback 與通用圖示；
// 標籤與搜尋結果相同，同名的實體加上第一個相關實體的名稱（nodeLabels()）；節點大小依看得到的關聯數，線粗依看得到的出處數
function elements(graph: Graph, language: string, labelGraph: Graph): ElementDefinition[] {
  const labels = nodeLabels(graph, language, labelGraph);
  const measure = labelMeasure();
  const relationLabel = new Map(relationTypes.map((t) => [t.id, t.label[language]]));
  const degree = relationCounts(graph);
  // 先排成一個圓作為起始位置，cose 不打亂起始位置（randomize: false），版面每次相同
  const step = (2 * Math.PI) / Math.max(graph.entities.length, 1);
  return [
    ...graph.entities.map((e, i) => {
      const size = nodeSize(degree.get(e.id) ?? 0);
      const label = labels.get(e.id) ?? "";
      return {
        // label 是完整名稱（選取、滑過時顯示）；shortLabel 是畫在圖上的截斷名稱（#288）
        data: { id: e.id, type: e.type, label, shortLabel: clampLabel(label, measure, NODE_LABEL_MAX_WIDTH, NODE_LABEL_MAX_LINES), size },
        position: { x: 300 * Math.cos(i * step), y: 300 * Math.sin(i * step) },
      };
    }),
    ...graph.relations.map((r) => ({
      data: {
        id: `relation:${r.id}`,
        relation: r.id,
        source: r.from,
        target: r.to,
        label: relationLabel.get(r.type) ?? r.type,
        width: edgeWidth(r.sources.length),
      },
    })),
  ];
}

// 目前生效的 CSS 變數（淺色或深色）；減少動態效果時 transition 為 0；深色模式時實體色調亮
export function currentStyle(reduced: boolean) {
  const style = getComputedStyle(document.documentElement);
  const dark = isDark(document.documentElement);
  return graphStyle((name) => style.getPropertyValue(name), entityTypes, motionDuration(reduced, EXPAND_MS), dark);
}

function markPath(cy: Core, path: PathStep[] | null) {
  cy.elements().removeClass("path");
  for (const step of path ?? []) {
    cy.$id(step.entity).addClass("path");
    if (step.relation !== undefined) cy.$id(`relation:${step.relation}`).addClass("path");
  }
}

// 選取的節點，以及它的相連關係（顯示關係名稱）。others 是選取實體以外的節點（圖譜頁有選取時）：
// 只有展示模式的樣式會用到（28% 不透明，graph-style.ts 的 presentationRules()），一般模式沒有對應的樣式
function markSelected(cy: Core, graph: Graph, selected: string | null, others = true) {
  const near = nearRelations(graph, selected);
  cy.batch(() => {
    cy.nodes().removeClass("selected others");
    if (selected !== null) cy.$id(selected).addClass("selected");
    if (selected !== null && others) cy.nodes().filter((n) => n.id() !== selected).addClass("others");
    cy.edges().removeClass("near");
    cy.edges().filter((e) => near.has(e.data("relation"))).addClass("near");
  });
}

// 鍵盤的目前實體（實線圈）、游標（虛線圈），以及連到目前實體的線（加粗、標關係名稱）
export function markKeyboard(cy: Core, keyboard: KeyboardMarks | null) {
  cy.batch(() => {
    cy.elements().removeClass("kb-current kb-cursor kb-near");
    if (keyboard === null || keyboard.current === null) return;
    const current = cy.$id(keyboard.current);
    current.addClass("kb-current");
    current.connectedEdges().addClass("kb-near");
    if (keyboard.cursor !== null) cy.$id(keyboard.cursor).addClass("kb-cursor");
  });
}

// 鍵盤的游標（沒有游標時是目前的實體）移到畫面外時平移到中央（sweep，減少動態效果時直接到位）
export function reveal(cy: Core, keyboard: KeyboardMarks | null, reduced: boolean) {
  const id = keyboard?.cursor ?? keyboard?.current ?? null;
  if (id === null) return;
  const node = cy.$id(id);
  if (node.empty()) return;
  const [box, extent] = [node.boundingBox(), cy.extent()];
  if (box.x1 >= extent.x1 && box.x2 <= extent.x2 && box.y1 >= extent.y1 && box.y2 <= extent.y2) return;
  const ms = motionDuration(reduced, PAN_MS);
  cy.stop(true, false);
  if (ms === 0) cy.center(node);
  else cy.animate({ center: { eles: node } }, { duration: ms, easing: "ease-in-out" });
}

// 畫布沒被底部面板蓋住的部分（rendered px）；cover 是 0 時是整個畫布
export function areaOf(cy: Core, cover: number): { width: number; height: number } {
  const top = cy.container()?.getBoundingClientRect().top ?? 0;
  return visibleArea({ top, width: cy.width(), height: cy.height() }, globalThis.innerHeight, cover);
}

// 節點平移到可見部分的中央（縮放不變，#257）；減少動態效果時直接到位
export function centerIn(cy: Core, node: CollectionReturnValue, area: { width: number; height: number }, ms: number) {
  if (node.empty()) return;
  const pan = panToCenter(node.position(), cy.zoom(), area);
  if (ms === 0) cy.pan(pan);
  else cy.animate({ pan }, { duration: ms, easing: "ease-in-out" });
}

// 縮放與全部顯示（鍵盤的 +／-／0）
export function zoomTo(cy: Core, level: number, reduced: boolean) {
  const position = { x: cy.width() / 2, y: cy.height() / 2 };
  const zoom = Math.min(Math.max(level, cy.minZoom()), cy.maxZoom());
  const ms = motionDuration(reduced, MOTION.fast);
  cy.stop(true, false);
  if (ms === 0) cy.zoom({ level: zoom, renderedPosition: position });
  else cy.animate({ zoom: { level: zoom, renderedPosition: position } }, { duration: ms, easing: "ease-out" });
}

export function fitAll(cy: Core, reduced: boolean) {
  const ms = motionDuration(reduced, PAN_MS);
  cy.stop(true, false);
  if (ms === 0) cy.fit(cy.elements(), 30);
  else cy.animate({ fit: { eles: cy.elements(), padding: 30 } }, { duration: ms, easing: "ease-in-out" });
}

// 聚焦集合以外變灰（找到多跳路徑時改為路徑以外變灰）；全部時都不變灰。類型篩選掉的實體與它們的線也變灰。
// isolated（按了「只看它」）時變灰的元素再加上 isolated，降到 15%；找到路徑時以路徑為準，維持 45%
function markFocus(cy: Core, graph: Graph, expansion: Expansion, path: PathStep[] | null, excluded: ReadonlySet<string>, isolated: boolean) {
  const focus =
    path === null
      ? focusOf(graph, expansion)
      : { entities: new Set(path.map((p) => p.entity)), relations: new Set(path.flatMap((p) => (p.relation === undefined ? [] : [p.relation]))) };
  cy.batch(() => {
    cy.elements().removeClass("dimmed isolated");
    cy.nodes().filter((n) => (focus !== null && !focus.entities.has(n.id())) || excluded.has(n.id())).addClass("dimmed");
    cy.edges()
      .filter((e) => (focus !== null && !focus.relations.has(e.data("relation"))) || excluded.has(e.data("source")) || excluded.has(e.data("target")))
      .addClass("dimmed");
    if (isolated && path === null) cy.$(".dimmed").addClass("isolated");
  });
}

// 新的線由關係的起點畫向終點：虛線的線段與間隔都比線長，把間隔的位移從線段長度動到 0，畫完後換回實線
function drawEdge(edge: EdgeSingular, ms: number) {
  const [a, b] = [edge.source().position(), edge.target().position()];
  // 曲線比直線長，留一些餘裕
  const dash = Math.hypot(b.x - a.x, b.y - a.y) * 1.5 + 1;
  const reset = () => edge.removeStyle("line-style line-dash-pattern line-dash-offset");
  edge.stop(true, true);
  edge.style({ "line-style": "dashed", "line-dash-pattern": [dash, dash], "line-dash-offset": dash });
  edge.animate({ style: { "line-dash-offset": 0 } }, { duration: ms, easing: "ease-out", complete: reset });
}

// 聚焦集合放不進畫面時，四邊留白（rendered px）
const FOCUS_PADDING = 40;

// 展開後的動態：新的線描出來；畫面平滑移動，讓選取的節點靠近中央（聚焦集合放不進畫面時改為聚焦集合整個放進畫面）；回到全部時顯示全貌。
// 手機的實體面板開著時（cover > 0），只平移：選取的節點放在面板以上的中央，縮放不變；聚焦集合超出可見部分時由使用者自己拖曳或縮放（#257）
function animateFocus(cy: Core, graph: Graph, previous: Expansion, next: Expansion, reduced: boolean, cover: number) {
  const [expandMs, panMs] = [motionDuration(reduced, EXPAND_MS), motionDuration(reduced, PAN_MS)];
  cy.stop(true, false);
  const center = (eles: CollectionReturnValue) => (panMs === 0 ? cy.center(eles) : cy.animate({ center: { eles } }, { duration: panMs, easing: "ease-in-out" }));
  const fit = (eles: CollectionReturnValue, padding: number) =>
    panMs === 0 ? cy.fit(eles, padding) : cy.animate({ fit: { eles, padding } }, { duration: panMs, easing: "ease-in-out" });

  const focus = focusOf(graph, next);
  if (focus === null) {
    fit(cy.elements(), 30);
    return;
  }
  if (expandMs > 0) {
    // 從全部開始展開時，聚焦集合的線都算新的
    const before = previous.length === 0 ? new Set<string>() : focusOf(graph, previous)?.relations ?? new Set<string>();
    cy.edges()
      .filter((e) => focus.relations.has(e.data("relation")) && !before.has(e.data("relation")))
      .forEach((e) => drawEdge(e, expandMs));
  }
  const selected = cy.$id(selectedOf(next) ?? "");
  const eles = cy.nodes().filter((n) => focus.entities.has(n.id()));
  const [box, extent] = [eles.boundingBox(), cy.extent()];
  if (cover > 0 && selected.nonempty()) centerIn(cy, selected, areaOf(cy, cover), panMs);
  else if (box.w <= extent.w && box.h <= extent.h) center(selected);
  else fit(eles, FOCUS_PADDING);
}

// cytoscape 快取容器在畫面上的位置，只在視窗大小改變、捲動與容器本身的大小改變時重新計算；
// 上方的內容出現或換行讓容器移動時，滑鼠座標會換算到錯的位置（#199）。
// 容器或上一層的大小改變時，以及每次按下指標（在 cytoscape 處理之前）時，位置變了就 resize() 讓它重新計算
export function trackContainer(element: HTMLElement, cy: Core): () => void {
  const rect = () => {
    const r = element.getBoundingClientRect();
    return `${r.left},${r.top},${r.width},${r.height}`;
  };
  let last = rect();
  const check = () => {
    const now = rect();
    if (now === last) return;
    last = now;
    cy.resize();
  };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
  observer?.observe(element);
  if (element.parentElement !== null) observer?.observe(element.parentElement);
  element.addEventListener("pointerdown", check, true);
  return () => {
    observer?.disconnect();
    element.removeEventListener("pointerdown", check, true);
  };
}

export function GraphView({ graph, language, selected, path, onSelect, expansion, excluded = NONE, isolated = false, compact = false, labelGraph = graph, keyboard = null, api, cover = 0 }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  // tap 事件在 cytoscape 實例建立時註冊，以 ref 取得最新的 onSelect
  const select = useRef(onSelect);
  select.current = onSelect;
  const reduced = useRef(false);
  // 上一次套用的展開狀態：判斷哪些線是新展開的
  const applied = useRef<Expansion>(ALL);
  // 上一次套用的 cover：面板打開（0 → 56%）但選取沒變時（再點同一個節點），也把選取的節點移到面板以上
  const appliedCover = useRef(cover);

  useEffect(() => {
    let cancelled = false;
    let untrack = () => {};
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (cancelled || container.current === null) return;
      const instance = cytoscape({
        container: container.current,
        elements: elements(graph, language, labelGraph),
        layout: { name: "cose", randomize: false, animate: false },
        style: currentStyle(reduced.current),
      });
      // 點空白處不清除選取（避免誤觸），圖譜頁以「回到全部」清除
      instance.on("tap", "node", (e) => select.current(e.target.id()));
      // 滑過變灰的節點時恢復不透明（graph-style.ts 的 node.dimmed.hover）
      instance.on("mouseover", "node", (e) => e.target.addClass("hover"));
      instance.on("mouseout", "node", (e) => e.target.removeClass("hover"));
      cy.current = instance;
      untrack = trackContainer(container.current, instance);
      // 版面只在讀入圖時排一次；展開、變灰、回到全部都只改 class，節點位置不動
      markSelected(instance, graph, selected, !compact);
      markFocus(instance, graph, expansion ?? ALL, path, excluded, isolated);
      applied.current = expansion ?? ALL;
      markPath(instance, path);
      markKeyboard(instance, keyboard);
    });
    return () => {
      cancelled = true;
      untrack();
      cy.current?.destroy();
      cy.current = null;
    };
    // selected、expansion 的變化在下面的 effect 處理，不重建圖
  }, [graph, language, labelGraph]);

  // 淺色／深色的標記改變（系統切換後的交叉淡換，#246）或減少動態效果時，重新讀出並套用到 cytoscape
  useEffect(() => {
    const restyle = () => cy.current?.style(currentStyle(reduced.current));
    const stopMotion = watchReducedMotion(
      (query) => window.matchMedia(query),
      (value) => {
        reduced.current = value;
        restyle();
      },
    );
    const stopScheme = watchColorScheme(document.documentElement, restyle);
    return () => (stopMotion(), stopScheme());
  }, []);

  useEffect(() => {
    // 鄰近圖（compact）的中心不算選取，其他節點不變淡
    if (cy.current !== null) markSelected(cy.current, graph, selected, !compact);
  }, [selected]);

  // 展開狀態改變時才播放動態；路徑與類型篩選只改變灰與標示
  useEffect(() => {
    const next = expansion ?? ALL;
    if (cy.current === null) return;
    markFocus(cy.current, graph, next, path, excluded, isolated);
    markPath(cy.current, path);
    const opened = cover > 0 && appliedCover.current === 0;
    appliedCover.current = cover;
    if (next === applied.current) {
      const id = selectedOf(next);
      if (opened && id !== null) {
        cy.current.stop(true, false);
        centerIn(cy.current, cy.current.$id(id), areaOf(cy.current, cover), motionDuration(reduced.current, PAN_MS));
      }
      return;
    }
    animateFocus(cy.current, graph, applied.current, next, reduced.current, cover);
    applied.current = next;
  }, [expansion, path, excluded, isolated, cover]);

  useEffect(() => {
    if (cy.current === null) return;
    markKeyboard(cy.current, keyboard);
    reveal(cy.current, keyboard, reduced.current);
  }, [keyboard?.current, keyboard?.cursor, keyboard === null]);

  useEffect(() => {
    if (api === undefined) return;
    api.current = {
      positions: () => new Map((cy.current?.nodes() ?? []).map((n) => [n.id(), { ...n.position() }])),
      zoomBy: (factor) => {
        if (cy.current !== null) zoomTo(cy.current, cy.current.zoom() * factor, reduced.current);
      },
      fit: () => {
        if (cy.current !== null) fitAll(cy.current, reduced.current);
      },
    };
    return () => {
      api.current = null;
    };
  }, [api]);

  // 圖譜頁的畫布對報讀器隱藏，改讀外框的報讀區（#289）；鄰近圖不變
  return <div ref={container} className={compact ? "graph-canvas compact" : "graph-canvas"} aria-hidden={compact ? undefined : true} />;
}
