// 以 cytoscape 畫出圖譜。cytoscape 以動態 import 載入：只用問答的人不必下載（build 時分成獨立的 chunk）。
import type { CollectionReturnValue, Core, EdgeSingular, ElementDefinition } from "cytoscape";
import { useEffect, useRef } from "react";
import { clientConfig } from "../client/load";
import { ALL, focusOf, nearRelations, selectedOf, type Expansion } from "../graph/expansion";
import type { PathStep } from "../graph/path";
import type { Graph } from "../graph/read";
import { entityName } from "./graph-labels";
import { DIMMED_NODE_SCALE, edgeWidth, graphStyle, nodeSize } from "./graph-style";
import { EXPAND_MS, motionDuration, PAN_MS, watchReducedMotion } from "./motion";
import { watchColorScheme } from "./theme";

interface Props {
  graph: Graph;
  language: string;
  selected: string | null;
  // 標示在圖上的路徑（多跳路徑）
  path: PathStep[] | null;
  onSelect(entityId: string): void;
  // 逐步展開（#199，圖譜頁）：聚焦集合以外的節點與線變灰；沒有傳入時不變灰（問答頁的鄰近圖）
  expansion?: Expansion;
  // 右側實體面板的小型鄰近圖（#195）：高度較低
  compact?: boolean;
}

const { entityTypes, relationTypes } = clientConfig.knowledgeModel;

// 節點的類型（type）決定外圈色與圖示，找不到類型時由 graphStyle() 套用 graphFallback 與通用圖示；
// 節點大小依看得到的關聯數（變灰時縮小），線粗依看得到的出處數
function elements(graph: Graph, language: string): ElementDefinition[] {
  const relationLabel = new Map(relationTypes.map((t) => [t.id, t.label[language]]));
  const degree = new Map<string, number>();
  for (const r of graph.relations) for (const id of [r.from, r.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  // 先排成一個圓作為起始位置，cose 不打亂起始位置（randomize: false），版面每次相同
  const step = (2 * Math.PI) / Math.max(graph.entities.length, 1);
  return [
    ...graph.entities.map((e, i) => {
      const size = nodeSize(degree.get(e.id) ?? 0);
      return {
        data: { id: e.id, type: e.type, label: entityName(e, language), size, dimmedSize: Math.round(size * DIMMED_NODE_SCALE) },
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

// 目前生效的 CSS 變數（淺色或深色）；減少動態效果時 transition 為 0
function currentStyle(reduced: boolean) {
  const style = getComputedStyle(document.documentElement);
  return graphStyle((name) => style.getPropertyValue(name), entityTypes, motionDuration(reduced, EXPAND_MS));
}

function markPath(cy: Core, path: PathStep[] | null) {
  cy.elements().removeClass("path");
  for (const step of path ?? []) {
    cy.$id(step.entity).addClass("path");
    if (step.relation !== undefined) cy.$id(`relation:${step.relation}`).addClass("path");
  }
}

// 選取的節點，以及它的相連關係（顯示關係名稱）
function markSelected(cy: Core, graph: Graph, selected: string | null) {
  const near = nearRelations(graph, selected);
  cy.batch(() => {
    cy.nodes().removeClass("selected");
    if (selected !== null) cy.$id(selected).addClass("selected");
    cy.edges().removeClass("near");
    cy.edges().filter((e) => near.has(e.data("relation"))).addClass("near");
  });
}

// 聚焦集合以外變灰；全部時都不變灰
function markFocus(cy: Core, graph: Graph, expansion: Expansion) {
  const focus = focusOf(graph, expansion);
  cy.batch(() => {
    cy.elements().removeClass("dimmed");
    if (focus === null) return;
    cy.nodes().filter((n) => !focus.entities.has(n.id())).addClass("dimmed");
    cy.edges().filter((e) => !focus.relations.has(e.data("relation"))).addClass("dimmed");
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

// 展開後的動態：新的線描出來；畫面平滑移動，讓選取的節點靠近中央（聚焦集合放不進畫面時改為聚焦集合整個放進畫面）；回到全部時顯示全貌
function animateFocus(cy: Core, graph: Graph, previous: Expansion, next: Expansion, reduced: boolean) {
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
  if (box.w <= extent.w && box.h <= extent.h) center(selected);
  else fit(eles, 40);
}

// cytoscape 快取容器在畫面上的位置，只在視窗大小改變、捲動與容器本身的大小改變時重新計算；
// 上方的內容出現或換行讓容器移動時，滑鼠座標會換算到錯的位置（#199）。
// 容器或上一層的大小改變時，以及每次按下指標（在 cytoscape 處理之前）時，位置變了就 resize() 讓它重新計算
function trackContainer(element: HTMLElement, cy: Core): () => void {
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

export function GraphView({ graph, language, selected, path, onSelect, expansion, compact = false }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  // tap 事件在 cytoscape 實例建立時註冊，以 ref 取得最新的 onSelect
  const select = useRef(onSelect);
  select.current = onSelect;
  const reduced = useRef(false);
  // 上一次套用的展開狀態：判斷哪些線是新展開的
  const applied = useRef<Expansion>(ALL);

  useEffect(() => {
    let cancelled = false;
    let untrack = () => {};
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (cancelled || container.current === null) return;
      const instance = cytoscape({
        container: container.current,
        elements: elements(graph, language),
        layout: { name: "cose", randomize: false, animate: false },
        style: currentStyle(reduced.current),
      });
      // 點空白處不清除選取（避免誤觸），圖譜頁以「回到全部」清除
      instance.on("tap", "node", (e) => select.current(e.target.id()));
      cy.current = instance;
      untrack = trackContainer(container.current, instance);
      // 版面只在讀入圖時排一次；展開、變灰、回到全部都只改 class，節點位置不動
      markSelected(instance, graph, selected);
      markFocus(instance, graph, expansion ?? ALL);
      applied.current = expansion ?? ALL;
      markPath(instance, path);
    });
    return () => {
      cancelled = true;
      untrack();
      cy.current?.destroy();
      cy.current = null;
    };
    // selected、expansion 的變化在下面的 effect 處理，不重建圖
  }, [graph, language]);

  // 系統切換淺色／深色或減少動態效果時，重新讀出並套用到 cytoscape
  useEffect(() => {
    const restyle = () => cy.current?.style(currentStyle(reduced.current));
    const stopMotion = watchReducedMotion(
      (query) => window.matchMedia(query),
      (value) => {
        reduced.current = value;
        restyle();
      },
    );
    const stopScheme = watchColorScheme((query) => window.matchMedia(query), restyle);
    return () => (stopMotion(), stopScheme());
  }, []);

  useEffect(() => {
    if (cy.current !== null) markSelected(cy.current, graph, selected);
  }, [selected]);

  useEffect(() => {
    const next = expansion ?? ALL;
    if (cy.current === null || next === applied.current) return;
    markFocus(cy.current, graph, next);
    animateFocus(cy.current, graph, applied.current, next, reduced.current);
    applied.current = next;
  }, [expansion]);

  useEffect(() => {
    if (cy.current !== null) markPath(cy.current, path);
  }, [path]);

  return <div ref={container} className={compact ? "graph-canvas compact" : "graph-canvas"} />;
}
