// 以 cytoscape 畫出圖譜。cytoscape 以動態 import 載入：只用問答的人不必下載（build 時分成獨立的 chunk）。
import type { Core, ElementDefinition } from "cytoscape";
import { useEffect, useRef } from "react";
import { clientConfig } from "../client/load";
import type { PathStep } from "../graph/path";
import type { Graph } from "../graph/read";
import { entityName } from "./graph-labels";
import { edgeWidth, graphStyle, nodeSize } from "./graph-style";
import { watchColorScheme } from "./theme";

interface Props {
  graph: Graph;
  language: string;
  selected: string | null;
  // 標示在圖上的路徑（多跳路徑）
  path: PathStep[] | null;
  onSelect(entityId: string | null): void;
  // 右側實體面板的小型鄰近圖（#195）：高度較低
  compact?: boolean;
}

const { entityTypes, relationTypes } = clientConfig.knowledgeModel;

// 節點的類型（type）決定外圈色與圖示，找不到類型時由 graphStyle() 套用 graphFallback 與通用圖示；
// 節點大小依看得到的關聯數，線粗依看得到的出處數
function elements(graph: Graph, language: string): ElementDefinition[] {
  const relationLabel = new Map(relationTypes.map((t) => [t.id, t.label[language]]));
  const degree = new Map<string, number>();
  for (const r of graph.relations) for (const id of [r.from, r.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  // 先排成一個圓作為起始位置，cose 不打亂起始位置（randomize: false），版面每次相同
  const step = (2 * Math.PI) / Math.max(graph.entities.length, 1);
  return [
    ...graph.entities.map((e, i) => ({
      data: { id: e.id, type: e.type, label: entityName(e, language), size: nodeSize(degree.get(e.id) ?? 0) },
      position: { x: 300 * Math.cos(i * step), y: 300 * Math.sin(i * step) },
    })),
    ...graph.relations.map((r) => ({
      data: {
        id: `relation:${r.id}`,
        source: r.from,
        target: r.to,
        label: relationLabel.get(r.type) ?? r.type,
        width: edgeWidth(r.sources.length),
      },
    })),
  ];
}

// 目前生效的 CSS 變數（淺色或深色）
function currentStyle() {
  const style = getComputedStyle(document.documentElement);
  return graphStyle((name) => style.getPropertyValue(name), entityTypes);
}

function markPath(cy: Core, path: PathStep[] | null) {
  cy.elements().removeClass("path");
  for (const step of path ?? []) {
    cy.$id(step.entity).addClass("path");
    if (step.relation !== undefined) cy.$id(`relation:${step.relation}`).addClass("path");
  }
}

export function GraphView({ graph, language, selected, path, onSelect, compact = false }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  // tap 事件在 cytoscape 實例建立時註冊，以 ref 取得最新的 onSelect
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (cancelled || container.current === null) return;
      const instance = cytoscape({
        container: container.current,
        elements: elements(graph, language),
        layout: { name: "cose", randomize: false, animate: false },
        style: currentStyle(),
      });
      instance.on("tap", "node", (e) => select.current(e.target.id()));
      instance.on("tap", (e) => e.target === instance && select.current(null));
      cy.current = instance;
      instance.$id(selected ?? "").addClass("selected");
      markPath(instance, path);
    });
    return () => {
      cancelled = true;
      cy.current?.destroy();
      cy.current = null;
    };
    // selected 的變化在下一個 effect 處理，不重建圖
  }, [graph, language]);

  // 系統切換淺色／深色時，CSS 變數已由 @media 改變，重新讀出並套用到 cytoscape
  useEffect(() => {
    return watchColorScheme((query) => window.matchMedia(query), () => {
      cy.current?.style(currentStyle());
    });
  }, []);

  useEffect(() => {
    cy.current?.nodes().removeClass("selected");
    if (selected !== null) cy.current?.$id(selected).addClass("selected");
  }, [selected]);

  useEffect(() => {
    if (cy.current !== null) markPath(cy.current, path);
  }, [path]);

  return <div ref={container} className={compact ? "graph-canvas compact" : "graph-canvas"} />;
}
