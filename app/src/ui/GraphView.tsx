// 以 cytoscape 畫出圖譜。cytoscape 以動態 import 載入：只用問答的人不必下載（build 時分成獨立的 chunk）。
import type { Core, ElementDefinition } from "cytoscape";
import { useEffect, useRef } from "react";
import { clientConfig } from "../client/load";
import type { Graph } from "../graph/read";
import { entityName } from "./graph-labels";

interface Props {
  graph: Graph;
  language: string;
  selected: string | null;
  onSelect(entityId: string | null): void;
}

const { entityTypes, relationTypes } = clientConfig.knowledgeModel;

function elements(graph: Graph, language: string): ElementDefinition[] {
  const color = new Map(entityTypes.map((t) => [t.id, t.color]));
  const relationLabel = new Map(relationTypes.map((t) => [t.id, t.label[language]]));
  // 先排成一個圓作為起始位置，cose 不打亂起始位置（randomize: false），版面每次相同
  const step = (2 * Math.PI) / Math.max(graph.entities.length, 1);
  return [
    ...graph.entities.map((e, i) => ({
      data: { id: e.id, label: entityName(e, language), color: color.get(e.type) ?? "#888888" },
      position: { x: 300 * Math.cos(i * step), y: 300 * Math.sin(i * step) },
    })),
    ...graph.relations.map((r) => ({
      data: { id: `relation:${r.id}`, source: r.from, target: r.to, label: relationLabel.get(r.type) ?? r.type },
    })),
  ];
}

export function GraphView({ graph, language, selected, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  // tap 事件在 cytoscape 實例建立時註冊，以 ref 取得最新的 onSelect
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (cancelled || container.current === null) return;
      const style = getComputedStyle(document.documentElement);
      const instance = cytoscape({
        container: container.current,
        elements: elements(graph, language),
        layout: { name: "cose", randomize: false, animate: false },
        style: [
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              label: "data(label)",
              color: style.getPropertyValue("--color-text"),
              "font-family": style.getPropertyValue("--font-body"),
              "font-size": 12,
              "text-valign": "bottom",
              "text-margin-y": 4,
            },
          },
          {
            selector: "edge",
            style: {
              width: 1.5,
              "line-color": style.getPropertyValue("--color-border"),
              "target-arrow-color": style.getPropertyValue("--color-border"),
              "target-arrow-shape": "triangle",
              "curve-style": "bezier",
              label: "data(label)",
              "font-size": 9,
              color: style.getPropertyValue("--color-textMuted"),
            },
          },
          { selector: "node.selected", style: { "border-width": 4, "border-color": style.getPropertyValue("--color-text") } },
        ],
      });
      instance.on("tap", "node", (e) => select.current(e.target.id()));
      instance.on("tap", (e) => e.target === instance && select.current(null));
      cy.current = instance;
      instance.$id(selected ?? "").addClass("selected");
    });
    return () => {
      cancelled = true;
      cy.current?.destroy();
      cy.current = null;
    };
    // selected 的變化在下一個 effect 處理，不重建圖
  }, [graph, language]);

  useEffect(() => {
    cy.current?.nodes().removeClass("selected");
    if (selected !== null) cy.current?.$id(selected).addClass("selected");
  }, [selected]);

  return <div ref={container} className="graph-canvas" />;
}
