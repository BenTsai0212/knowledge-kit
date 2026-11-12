// 三層語意縮放的視角（#254，PR #316 審查）：以大型資料實際排版（headless cytoscape），
// 檢查全覽、每個群組層與細節層換到目標視角後，所有節點（含外圍 60px 的群組泡泡）都在畫布內，且縮放不超過上限
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { describe, expect, it } from "vitest";
import { bubbleDiameter, clusterGraph, type Clustering } from "../../src/graph/clusters";
import type { Graph } from "../../src/graph/read";
import { nodeSize } from "../../src/ui/graph-style";
import { arrange, bubbleId, detailOf, MAX_VIEW_ZOOM, openEntities, SIDE_BUBBLE, viewOf, viewportFor, type ZoomLevel } from "../../src/ui/graph-zoom";
import { largeGraph, LARGE_MODEL, LARGE_MODEL_NO_CONTAINER } from "../fixtures/large-graph";

const CANVAS = { width: 800, height: 600 };

function draw(graph: Graph, clustering: Clustering, level: ZoomLevel, clusterId: string | null, selected: string | null): Core {
  const cluster = clustering.clusters.find((c) => c.id === clusterId);
  const detail = level === "detail" && cluster !== undefined && selected !== null ? detailOf(graph, cluster, selected) : null;
  const open = openEntities(level, cluster, selected, detail, false);
  const view = viewOf(graph, clustering, open, new Set(detail?.collapsed ?? []));
  const elements: ElementDefinition[] = [
    ...view.entities.map((id) => ({ data: { id, size: nodeSize(3) }, classes: "entity" })),
    ...view.bubbles.map((id) => {
      const members = clustering.clusters.find((c) => c.id === id)!.members.length;
      return { data: { id: bubbleId(id), size: level === "overview" ? bubbleDiameter(members) : SIDE_BUBBLE }, classes: "bubble" };
    }),
    ...view.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target } })),
  ];
  return cytoscape({ headless: true, styleEnabled: true, elements, style: [{ selector: "node", style: { width: "data(size)", height: "data(size)" } }] });
}

function expectInside(cy: Core) {
  const target = viewportFor(cy.elements().boundingBox(), CANVAS);
  cy.viewport(target);
  expect(cy.zoom()).toBeLessThanOrEqual(MAX_VIEW_ZOOM);
  cy.nodes().forEach((n) => {
    const b = n.renderedBoundingBox();
    expect(b.x1, n.id()).toBeGreaterThanOrEqual(-1e-6);
    expect(b.y1, n.id()).toBeGreaterThanOrEqual(-1e-6);
    expect(b.x2, n.id()).toBeLessThanOrEqual(CANVAS.width + 1e-6);
    expect(b.y2, n.id()).toBeLessThanOrEqual(CANVAS.height + 1e-6);
  });
}

describe.each([
  ["容器分群", LARGE_MODEL],
  ["社群偵測", LARGE_MODEL_NO_CONTAINER],
])("大型資料的視角（%s）", (_, model) => {
  const graph = largeGraph();
  const clustering = clusterGraph(graph, model);
  const overview = draw(graph, clustering, "overview", null, null);
  const origins = arrange(overview, "overview", { x: 0, y: 0 });
  // 最大、最小與中間的群組
  const sorted = clustering.clusters;
  const picked = [...new Set([sorted[0]!, sorted[Math.floor(sorted.length / 2)]!, sorted[sorted.length - 1]!])];

  it("全覽的泡泡與聚合線都在畫布內", () => {
    expectInside(overview);
  });

  it.each(picked.map((c) => [c.id, c.members.length] as const))("群組層 %s（%i 個實體）：群內節點與外圍的群組都在畫布內", (id) => {
    const cy = draw(graph, clustering, "cluster", id, null);
    arrange(cy, "cluster", origins.get(bubbleId(id))!);
    expect(cy.nodes(".bubble").length).toBe(clustering.clusters.length - 1);
    expectInside(cy);
  });

  it("細節層：選取的實體、直接與二度相關的實體都在畫布內", () => {
    const c = sorted[0]!;
    const cy = draw(graph, clustering, "detail", c.id, c.members[0]!);
    arrange(cy, "detail", origins.get(bubbleId(c.id))!);
    expect(cy.nodes(".entity").length).toBeGreaterThan(1);
    expectInside(cy);
  });
});
