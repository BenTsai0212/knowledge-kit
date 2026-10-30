// cytoscape 的配色：從 CSS 變數（theme.json）讀出，淺色與深色切換時由 GraphView 重新套用。
// 節點的顏色是實體類型的 color（knowledge-model.json），找不到類型時用 graphFallback。
import type { StylesheetJson } from "cytoscape";

// 讀取 CSS 變數，例如 (name) => getComputedStyle(document.documentElement).getPropertyValue(name)
export type ReadVariable = (name: string) => string;

export function graphStyle(read: ReadVariable): StylesheetJson {
  const v = (name: string) => read(name).trim();
  // 標籤加上背景色的外框，讓文字在節點與邊上、淺色與深色背景都清楚可讀
  const outline = { "text-outline-color": v("--color-background"), "text-outline-width": 2 };
  return [
    {
      selector: "node",
      style: {
        "background-color": v("--color-graphFallback"),
        label: "data(label)",
        color: v("--color-text"),
        "font-family": v("--font-body"),
        "font-size": 12,
        "text-valign": "bottom",
        "text-margin-y": 4,
        ...outline,
      },
    },
    { selector: "node[color]", style: { "background-color": "data(color)" } },
    {
      selector: "edge",
      style: {
        width: 1.5,
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
    { selector: "node.selected", style: { "border-width": 4, "border-color": v("--color-text") } },
    { selector: "node.path", style: { "border-width": 4, "border-color": v("--color-primary") } },
    {
      selector: "edge.path",
      style: {
        width: 4,
        "line-color": v("--color-primary"),
        "target-arrow-color": v("--color-primary"),
      },
    },
  ];
}
