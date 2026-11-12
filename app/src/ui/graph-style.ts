// cytoscape 的配色：從 CSS 變數（theme.json）讀出，淺色與深色切換時由 GraphView 重新套用。
// 設計系統 v1（#240，docs/design.md「實體顏色」）：節點是「形狀＋填色」，形狀與入口頁主視覺相同（entry-hero.ts 的 heroShape()），
// 填色是實體類型色（Dark 調亮），圖示是 surface 色；找不到類型時用 graphFallback、圓形與通用圖示。節點大小＝關聯數，線粗＝出處數。
// 逐步展開與找路徑時，聚焦集合以外的節點與線降低不透明度（dimmed，不隱藏）；關係名稱只在選取節點的相連關係（near）顯示。
// 圖只有目前身分看得到的實體與關係，這裡不畫任何「有內容被隱藏」的痕跡。
import type { StylesheetJson } from "cytoscape";
import type { EntityType } from "../client/types";
import { iconDataUri } from "./entity-icons";
import { heroShape, type HeroShape } from "./entry-hero";

// 節點名稱最寬 112px、最多兩行，超過以「…」截斷（#288，docs/design.md「英文版面」；截斷在 graph-labels.ts 的 clampLabel()）。
// 截斷後的文字在 shortLabel，完整名稱在 label：選取與滑過時顯示完整名稱，實體面板與搜尋結果也是完整名稱
export const NODE_LABEL_MAX_WIDTH = 112;
export const NODE_LABEL_MAX_LINES = 2;
export const NODE_LABEL_FONT_SIZE = 12;

// 讀取 CSS 變數，例如 (name) => getComputedStyle(document.documentElement).getPropertyValue(name)
export type ReadVariable = (name: string) => string;

// Dark 的實體色：以 color-mix(in srgb, 類型色 75%, text) 調亮，與入口頁主視覺（app.css 的 .hero__shape）相同，
// 近似 docs/design.md「實體顏色」的 OKLCH 公式；check-client.mjs 以同一個比例檢查圖示的對比
export const DARK_ENTITY_MIX = 75;
// 連線：border 加深一階（border 75% + text），不新增 token（#240 決定 2）
export const EDGE_MIX = 75;
// 變灰的元素：45% 不透明；按「只看它」之後 15%（#240 決定 1、3）
export const DIMMED_OPACITY = 0.45;
export const ISOLATED_OPACITY = 0.15;
// 鍵盤的目前實體與游標的圈（#289）
export const KEYBOARD_RING = 3;

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

// 主視覺的形狀換成 cytoscape 的形狀：部門的圓角較大、專案的圓角較小
export const NODE_SHAPES: Record<HeroShape, { shape: "ellipse" | "round-rectangle"; "corner-radius"?: string }> = {
  circle: { shape: "ellipse" },
  block: { shape: "round-rectangle", "corner-radius": "9px" },
  tile: { shape: "round-rectangle", "corner-radius": "4px" },
};

type TypeStyle = Pick<EntityType, "id" | "color" | "icon">;

// 類型的形狀、填色（Dark 調亮）與 surface 色的圖示
function typeRule(selector: string, color: string, icon: TypeStyle["icon"] | undefined, v: (name: string) => string, dark: boolean) {
  const fill = dark ? mix(color, DARK_ENTITY_MIX, v("--color-text")) : color;
  return {
    selector,
    style: { ...NODE_SHAPES[heroShape(icon)], "background-color": fill, "background-image": iconDataUri(icon ?? "generic", v("--color-surface")) },
  };
}

// transitionMs：節點與線在變灰／展開之間的 transition 時間（減少動態效果時為 0，見 motion.ts）；dark：目前是否為深色模式
export function graphStyle(read: ReadVariable, types: TypeStyle[], transitionMs = 0, dark = false): StylesheetJson {
  const v = (name: string) => read(name).trim();
  const transition = { "transition-duration": transitionMs, "transition-timing-function": "ease-out" as const };
  // 標籤加上背景色的外框，讓文字在節點與邊上、淺色與深色背景都清楚可讀
  const outline = { "text-outline-color": v("--color-background"), "text-outline-width": 2 };
  // 節點標籤與關係名稱都以不透明的面板底色（畫布在 .card 內）襯底，不壓到經過的連線
  const labelBackground = {
    "text-background-color": v("--color-surface"),
    "text-background-opacity": 1,
    "text-background-padding": "2px",
    "text-background-shape": "roundrectangle" as const,
  };
  const edgeColor = mix(v("--color-border"), EDGE_MIX, v("--color-text"));
  return [
    {
      selector: "node",
      style: {
        label: "data(shortLabel)",
        color: v("--color-text"),
        "font-family": v("--font-body"),
        "font-size": NODE_LABEL_FONT_SIZE,
        "text-valign": "bottom",
        "text-margin-y": 6,
        // 長標籤換行；文字與襯底的對比就是 text 與 surface 的對比，由 check:client 檢查（#207）
        "text-wrap": "wrap",
        "text-max-width": `${NODE_LABEL_MAX_WIDTH}px`,
        ...labelBackground,
        ...outline,
        width: "data(size)",
        height: "data(size)",
        "border-width": 0,
        "background-width": "55%",
        "background-height": "55%",
        "transition-property": "opacity",
        ...transition,
      },
    },
    typeRule("node", v("--color-graphFallback"), undefined, v, dark),
    ...types.map((t) => typeRule(`node[type = "${t.id}"]`, t.color, t.icon, v, dark)),
    {
      selector: "edge",
      style: {
        width: "data(width)",
        "line-color": edgeColor,
        "target-arrow-color": edgeColor,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        // 關係名稱：fonts.mono 小字、surface 底
        "font-size": 9,
        "font-family": v("--font-mono"),
        color: v("--color-textMuted"),
        ...labelBackground,
        "transition-property": "opacity",
        ...transition,
      },
    },
    // 關係名稱只在選取節點的相連關係顯示
    { selector: "edge.near", style: { label: "data(label)" } },
    // 變灰：不隱藏，保留整體輪廓，降到 45% 不透明（「只看它」之後 15%）。變灰的內容是背景，標籤對比刻意降低；
    // 滑過時恢復（最後的 hover），節點仍可點（#240 決定 3）
    { selector: ".dimmed", style: { opacity: DIMMED_OPACITY } },
    { selector: ".dimmed.isolated", style: { opacity: ISOLATED_OPACITY } },
    // 選取：外面一圈 background 間隙＋2px text 外環
    {
      selector: "node.selected",
      style: { "border-width": 2, "border-color": v("--color-background"), "outline-width": 2, "outline-color": v("--color-text") },
    },
    // 找路徑的結果：路徑節點加 primary 外環，路徑上的線用 primary 加粗
    {
      selector: "node.path",
      style: { "border-width": 2, "border-color": v("--color-background"), "outline-width": 2, "outline-color": v("--color-primary") },
    },
    { selector: "edge.path", style: { width: 5, "line-color": v("--color-primary"), "target-arrow-color": v("--color-primary") } },
    // 滑過變灰的節點時恢復 100% 不透明，標籤在要讀的時候可讀（#240 決定 3）
    { selector: "node.dimmed.hover", style: { opacity: 1 } },
    // 選取與滑過時顯示完整名稱（#288），疊在其他節點的標籤上面
    { selector: "node.selected, node.hover", style: { label: "data(label)", "z-index": 10 } },
    // 鍵盤操作（#289，docs/design.md「圖譜的鍵盤操作與螢幕報讀器」）：目前的實體是 focus 色 3px 實線圈、游標是虛線圈；
    // 連到目前實體的線加粗成 primary 並標出關係名稱。鍵盤要看得到的元素不變灰（與 hover 相同恢復 100%）
    { selector: "node.kb-current", style: { "outline-width": KEYBOARD_RING, "outline-style": "solid", "outline-color": v("--color-focus"), "outline-offset": 2 } },
    { selector: "node.kb-cursor", style: { "outline-width": KEYBOARD_RING, "outline-style": "dashed", "outline-color": v("--color-focus"), "outline-offset": 2 } },
    // 目前實體與游標和選取、滑過一樣顯示完整名稱（#288 的截斷不套用；報讀也一律用完整名稱）
    { selector: "node.kb-current, node.kb-cursor", style: { opacity: 1, label: "data(label)", "z-index": 10 } },
    {
      selector: "edge.kb-near",
      style: { label: "data(label)", width: 4, "line-color": v("--color-primary"), "target-arrow-color": v("--color-primary"), opacity: 1 },
    },
  ];
}
