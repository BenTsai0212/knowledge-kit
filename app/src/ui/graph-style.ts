// cytoscape 的配色：從 CSS 變數（theme.json）讀出，淺色與深色切換時由 GraphView 重新套用。
// 節點是白底（surface）圓形、實體類型色（knowledge-model.json 的 color）的外圈與圖示（icon，#199）；
// 找不到類型時用 graphFallback 與通用圖示。節點大小＝關聯數，線粗＝出處數。
import type { StylesheetJson } from "cytoscape";
import type { EntityType } from "../client/types";
import { iconDataUri } from "./entity-icons";

// 讀取 CSS 變數，例如 (name) => getComputedStyle(document.documentElement).getPropertyValue(name)
export type ReadVariable = (name: string) => string;

// 選取的節點換成類型色的淡色底（與 check-client.mjs 的 SELECTED_NODE_TINT 相同，對比在那裡檢查）
export const SELECTED_NODE_TINT = 14;

// 關聯數 0 → 32px，每多一個關聯加 4px，最多 64px
export function nodeSize(degree: number): number {
  return 32 + 4 * Math.min(degree, 8);
}

// 出處 1 個 → 1.75px，每多一個加 0.75px，最多 5 個（4.75px）
export function edgeWidth(sources: number): number {
  return 1 + 0.75 * Math.min(Math.max(sources, 1), 5);
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// 與 CSS 的 color-mix(in srgb, a p%, b) 相同：在 sRGB 數值上線性內插
export function mix(a: string, percent: number, b: string): string {
  const [x, y] = [channels(a), channels(b)];
  return `#${x.map((v, i) => Math.round((v * percent + y[i] * (100 - percent)) / 100).toString(16).padStart(2, "0")).join("")}`;
}

type TypeStyle = Pick<EntityType, "id" | "color" | "icon">;

// 選取時：類型色的淡色底，圖示改用 text（深色模式中類型色在淡色底上不足 3:1）
function typeRules(selector: string, color: string, icon: TypeStyle["icon"], v: (name: string) => string): StylesheetJson {
  return [
    { selector, style: { "border-color": color, "background-image": iconDataUri(icon, color) } },
    {
      selector: `${selector}.selected`,
      style: {
        "background-color": mix(color, SELECTED_NODE_TINT, v("--color-surface")),
        "background-image": iconDataUri(icon, v("--color-text")),
      },
    },
  ];
}

export function graphStyle(read: ReadVariable, types: TypeStyle[]): StylesheetJson {
  const v = (name: string) => read(name).trim();
  // 標籤加上背景色的外框，讓文字在節點與邊上、淺色與深色背景都清楚可讀
  const outline = { "text-outline-color": v("--color-background"), "text-outline-width": 2 };
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        color: v("--color-text"),
        "font-family": v("--font-body"),
        "font-size": 12,
        "text-valign": "bottom",
        "text-margin-y": 4,
        ...outline,
        shape: "ellipse",
        width: "data(size)",
        height: "data(size)",
        "background-color": v("--color-surface"),
        "border-width": 3,
        "background-width": "55%",
        "background-height": "55%",
      },
    },
    ...typeRules("node", v("--color-graphFallback"), "generic", v),
    ...types.flatMap((t) => typeRules(`node[type = "${t.id}"]`, t.color, t.icon, v)),
    {
      selector: "edge",
      style: {
        width: "data(width)",
        "line-color": v("--color-border"),
        "target-arrow-color": v("--color-border"),
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": 9,
        color: v("--color-textMuted"),
        ...outline,
      },
    },
    // 選取：淡色底（上面依類型設定）＋陰影
    {
      selector: "node.selected",
      style: {
        "border-width": 4,
        "underlay-color": v("--color-text"),
        "underlay-opacity": 0.15,
        "underlay-padding": 6,
        "underlay-shape": "ellipse",
      },
    },
    { selector: "node.path", style: { "border-width": 5, "border-color": v("--color-primary") } },
    {
      selector: "edge.path",
      style: {
        width: 5,
        "line-color": v("--color-primary"),
        "target-arrow-color": v("--color-primary"),
      },
    },
  ];
}
