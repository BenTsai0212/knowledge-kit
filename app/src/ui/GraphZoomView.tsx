// 大量節點時的圖譜（#254）：全覽（泡泡與聚合線）、群組、細節三層，以 cytoscape 畫出。門檻以下用 GraphView（現行的全部節點）。
// 換層級時換掉元素再排版；排版結果依層級（全覽、群組、細節的實體）快取，切換身分或篩選時（graph 改變）重新建立。
import type { Core, ElementDefinition } from "cytoscape";
import { useEffect, useRef, type RefObject } from "react";
import { clientConfig } from "../client/load";
import { aggregateWidth, bubbleDiameter, labelledInCluster, type Clustering } from "../graph/clusters";
import type { Graph } from "../graph/read";
import { relationCounts } from "../graph/search";
import { clampLabel, nodeLabels } from "./graph-labels";
import { compositionDots, edgeWidth, NODE_LABEL_MAX_LINES, NODE_LABEL_MAX_WIDTH, nodeSize } from "./graph-style";
import { arrange, bubbleId, CALM_LIMIT, detailOf, openEntities, panToCenter, SIDE_BUBBLE, viewOf, viewportFor, type ZoomLevel } from "./graph-zoom";
import { areaOf, centerIn, currentStyle, fitAll, labelMeasure, markKeyboard, reveal, trackContainer, zoomTo, type GraphViewApi, type KeyboardMarks } from "./GraphView";
import { EXPAND_MS, motionDuration, PAN_MS, watchReducedMotion } from "./motion";
import { watchColorScheme } from "./theme";

interface Props {
  // 篩選後的可見圖與它的分群
  graph: Graph;
  clustering: Clustering;
  level: ZoomLevel;
  cluster: string | null;
  selected: string | null;
  // 細節層按了「＋N 位成員 · 展開」
  showMembers: boolean;
  language: string;
  clusterName(clusterId: string): string;
  segments(count: number): string;
  onSelect(entityId: string): void;
  onOpenCluster(clusterId: string): void;
  keyboard?: KeyboardMarks | null;
  api?: RefObject<GraphViewApi | null>;
  // 手機的實體面板蓋住視窗下方的比例（#257，見 GraphView）：細節層選取的節點平移到面板以上的中央
  cover?: number;
}

type Positions = Map<string, { x: number; y: number }>;

const { entityTypes, relationTypes } = clientConfig.knowledgeModel;

// 條件成立的 class 以空白接起來
const classNames = (flags: Record<string, boolean>) =>
  Object.keys(flags)
    .filter((name) => flags[name])
    .join(" ");

function elements(p: Props): ElementDefinition[] {
  const { graph, clustering, level, selected, language } = p;
  const cluster = clustering.clusters.find((c) => c.id === p.cluster);
  const detail = level === "detail" && cluster !== undefined && selected !== null ? detailOf(graph, cluster, selected) : null;
  const open = openEntities(level, cluster, selected, detail, p.showMembers);
  const hidden = new Set(detail !== null && !p.showMembers ? detail.collapsed : []);
  const view = viewOf(graph, clustering, open, hidden);
  const labels = nodeLabels(graph, language, graph);
  const measure = labelMeasure();
  const degree = relationCounts(graph);
  // 群組層只標出群內關聯最多的前 10%，細節層全部標出
  const labelled = level === "cluster" && cluster !== undefined ? labelledInCluster(graph, cluster) : null;
  const typeOf = new Map(graph.entities.map((e) => [e.id, e.type]));
  const relation = new Map(graph.relations.map((r) => [r.id, r]));
  const relationLabel = new Map(relationTypes.map((t) => [t.id, t.label[language]]));
  const color = new Map(entityTypes.map((t) => [t.id, t.color]));
  const context = (id: string) => detail !== null && id !== selected && !detail.near.has(id);
  return [
    ...view.entities.map((id) => {
      const label = labels.get(id) ?? "";
      return {
        data: { id, type: typeOf.get(id), label, shortLabel: clampLabel(label, measure, NODE_LABEL_MAX_WIDTH, NODE_LABEL_MAX_LINES), size: nodeSize(degree.get(id) ?? 0) },
        classes: classNames({ entity: true, unlabelled: labelled !== null && !labelled.has(id), selected: id === selected, others: selected !== null && id !== selected, second: context(id) }),
      };
    }),
    ...view.bubbles.map((id) => {
      const c = clustering.clusters.find((x) => x.id === id)!;
      const data = {
        id: bubbleId(id),
        cluster: id,
        type: c.composition[0]?.type,
        label: `${c.members.length}\n${p.clusterName(id)}`,
        size: level === "overview" ? bubbleDiameter(c.members.length) : SIDE_BUBBLE,
        dots: compositionDots(c.composition.map((t) => color.get(t.type) ?? "")),
      };
      return { data, classes: classNames({ bubble: true, side: level !== "overview", second: detail !== null }) };
    }),
    ...view.edges.map((e) => {
      const single = e.relations.length === 1 ? relation.get(e.relations[0]!)! : null;
      const role = detail === null ? "" : e.relations.some((r) => detail.direct.has(r)) ? "direct" : "second";
      if (single !== null)
        return {
          data: {
            id: e.id,
            relation: single.id,
            source: e.source,
            target: e.target,
            label: relationLabel.get(single.type) ?? single.type,
            width: edgeWidth(single.sources.length),
          },
          classes: role,
        };
      return { data: { id: e.id, source: e.source, target: e.target, label: p.segments(e.relations.length), width: aggregateWidth(e.relations.length) }, classes: `aggregate ${role}`.trim() };
    }),
  ];
}

const layoutKey = (p: Props) => (p.level === "overview" ? "overview" : p.level === "cluster" ? `cluster:${p.cluster}` : `detail:${p.selected}:${p.showMembers}`);

export function GraphZoomView(props: Props) {
  const { graph, keyboard = null, api } = props;
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const reduced = useRef(false);
  const cache = useRef(new Map<string, Positions>());
  // 可見節點超過 150 個時關閉展開的動態與 transition（減少動態效果時也一樣）
  const calm = graph.entities.length > CALM_LIMIT;

  // 換元素、排版（有快取時沿用），再播放 expand（從泡泡的位置展開）與 sweep（平移到展開的範圍）
  const show = (instance: Core, previous: ZoomLevel | null) => {
    const p = latest.current;
    const key = layoutKey(p);
    const origin = cache.current.get("overview")?.get(bubbleId(p.cluster ?? "")) ?? { x: 0, y: 0 };
    instance.stop(true, false);
    instance.elements().remove();
    instance.add(elements(p));
    const saved = cache.current.get(key);
    if (saved !== undefined) instance.nodes().forEach((n) => void n.position(saved.get(n.id()) ?? n.position()));
    else cache.current.set(key, arrange(instance, p.level, origin));
    // 目標視角以最終位置計算（含外圍的群組泡泡與標籤），再把節點移回泡泡的位置播放 expand。
    // 手機的實體面板開著時（#257），縮放與沒有面板時相同（以整個畫布計算），只把選取的節點平移到面板以上的中央
    const cover = p.cover ?? 0;
    shownCover.current = cover;
    const whole = viewportFor(instance.elements().boundingBox(), { width: instance.width(), height: instance.height() });
    const chosen = instance.$id(p.selected ?? "");
    const target =
      cover > 0 && p.level === "detail" && chosen.nonempty()
        ? { zoom: whole.zoom, pan: panToCenter(chosen.position(), whole.zoom, areaOf(instance, cover)) }
        : whole;
    const still = reduced.current || calm;
    if (!still && previous === "overview" && p.level !== "overview")
      instance.nodes(".entity").forEach((n) => {
        const to = { ...n.position() };
        n.position(origin);
        n.animate({ position: to }, { duration: EXPAND_MS, easing: "ease-out" });
      });
    const ms = motionDuration(reduced.current, PAN_MS);
    if (ms === 0 || previous === null) instance.viewport(target);
    else instance.animate(target, { duration: ms, easing: "ease-in-out" });
  };
  const shown = useRef<ZoomLevel | null>(null);
  const shownCover = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let untrack = () => {};
    cache.current = new Map();
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (cancelled || container.current === null) return;
      const instance = cytoscape({
        container: container.current,
        style: currentStyle(reduced.current || calm),
        // 節點很多時拖曳、縮放期間不畫標籤
        hideLabelsOnViewport: calm,
        textureOnViewport: calm,
      });
      instance.on("tap", "node", (e) => {
        const cluster = e.target.data("cluster") as string | undefined;
        if (cluster !== undefined) latest.current.onOpenCluster(cluster);
        else latest.current.onSelect(e.target.id());
      });
      instance.on("mouseover", "node", (e) => e.target.addClass("hover"));
      instance.on("mouseout", "node", (e) => e.target.removeClass("hover"));
      cy.current = instance;
      untrack = trackContainer(container.current, instance);
      show(instance, null);
      shown.current = latest.current.level;
      markKeyboard(instance, keyboard);
    });
    return () => {
      cancelled = true;
      untrack();
      cy.current?.destroy();
      cy.current = null;
    };
  }, [graph, props.clustering, props.language]);

  useEffect(() => {
    if (cy.current === null) return;
    show(cy.current, shown.current);
    shown.current = props.level;
    markKeyboard(cy.current, keyboard);
  }, [props.level, props.cluster, props.selected, props.showMembers]);

  // 面板打開（0 → 56%）但選取沒變時（再點同一個節點），把選取的節點移到面板以上
  useEffect(() => {
    const cover = props.cover ?? 0;
    const opened = cover > 0 && shownCover.current === 0;
    shownCover.current = cover;
    if (cy.current === null || !opened || props.level !== "detail" || props.selected === null) return;
    cy.current.stop(true, false);
    centerIn(cy.current, cy.current.$id(props.selected), areaOf(cy.current, cover), motionDuration(reduced.current, PAN_MS));
  }, [props.cover]);

  useEffect(() => {
    const restyle = () => cy.current?.style(currentStyle(reduced.current || calm));
    const stopMotion = watchReducedMotion(
      (query) => window.matchMedia(query),
      (value) => {
        reduced.current = value;
        restyle();
      },
    );
    const stopScheme = watchColorScheme(document.documentElement, restyle);
    return () => (stopMotion(), stopScheme());
  }, [calm]);

  useEffect(() => {
    if (cy.current === null) return;
    markKeyboard(cy.current, keyboard);
    reveal(cy.current, keyboard, reduced.current);
  }, [keyboard?.current, keyboard?.cursor, keyboard === null]);

  useEffect(() => {
    if (api === undefined) return;
    api.current = {
      positions: () => new Map((cy.current?.nodes(".entity") ?? []).map((n) => [n.id(), { ...n.position() }])),
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

  return <div ref={container} className="graph-canvas" aria-hidden={true} data-testid="graph-zoom" />;
}
