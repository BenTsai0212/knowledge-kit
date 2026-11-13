// cytoscape 的配色：從 CSS 變數（theme.json）讀出，淺色與深色切換時由 GraphView 重新套用。
// 設計系統 v1（#240，docs/design.md「實體顏色」）：節點是「形狀＋填色」，形狀與入口頁主視覺相同（entry-hero.ts 的 heroShape()），
// 填色是實體類型色（Dark 調亮），圖示是 surface 色；找不到類型時用 graphFallback、圓形與通用圖示。節點大小＝關聯數，線粗＝出處數。
// 逐步展開與找路徑時，聚焦集合以外的節點與線降低不透明度（dimmed，不隱藏）；關係名稱只在選取節點的相連關係（near）顯示。
// 展示模式（#260）以 app.css 的 --present-* 放大標籤、選取實體以外的節點降到 28%（presentationRules()）。
// 一般模式（#336，畫板 Graph）：選取的節點是 surface 間隙＋text 外環、名稱反白；關係名稱是加框的小標籤；剛展開的節點標「剛展開」。展示模式不套用
// 圖只有目前身分看得到的實體與關係，這裡不畫任何「有內容被隱藏」的痕跡。
import type { StylesheetJson } from "cytoscape";
import type { EntityType } from "../client/types";
import { iconDataUri } from "./entity-icons";
import { heroShape, type HeroShape } from "./entry-hero";
import { SECOND_OPACITY, SIDE_BUBBLE_OPACITY } from "./graph-zoom";

// 節點名稱最寬 112px、最多兩行，超過以「…」截斷（#288，docs/design.md「英文版面」；截斷在 graph-labels.ts 的 clampLabel()）。
// 截斷後的文字在 shortLabel，完整名稱在 label：選取與滑過時顯示完整名稱，實體面板與搜尋結果也是完整名稱
export const NODE_LABEL_MAX_WIDTH = 112;
export const NODE_LABEL_MAX_LINES = 2;
export const NODE_LABEL_FONT_SIZE = 12;
// 桌機選取與逐步展開時的縮放上限（#336 修正要求）：節點標籤在畫面上不超過 16px（關係標籤同比例，11px × 4/3 ≈ 14.7px）。
// 畫板 Graph 選取後節點標籤 14px、關係標籤 12px；放得更大時標籤互相壓住、畫布邊緣的節點被切掉
export const FOCUS_LABEL_MAX_PX = 16;
export const FOCUS_MAX_ZOOM = FOCUS_LABEL_MAX_PX / NODE_LABEL_FONT_SIZE;
// 下限是標籤原本的 12px（聚焦集合放得進畫布時才放大到這裡）
export const FOCUS_MIN_ZOOM = 1;

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
// 展示模式（#260）：選取實體以外的節點（others）降到 28% 不透明
export const PRESENT_OTHERS_OPACITY = 0.28;
// 展示模式選取的關係的線粗
export const PRESENT_NEAR_WIDTH = 5;

// 選取的節點（#336，畫板 Graph）：4px surface 間隙＋3px text 外環
export const SELECTED_GAP = 4;
export const SELECTED_RING = 3;

// 一般模式的關係名稱（#336）：text 色 11px、surface 底加 1px border 的小標籤
function relationTag(v: (name: string) => string) {
  return {
    "font-size": 11,
    "font-family": v("--font-body"),
    color: v("--color-text"),
    "text-background-padding": "3px",
    "text-border-width": 1,
    "text-border-color": v("--color-border"),
    "text-border-opacity": 1,
  };
}

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

// 泡泡的類型組成：三個小點（實體數多的類型在前），畫在泡泡下方
export function compositionDots(colors: readonly string[]): string {
  const dots = colors.map((c, i) => `<circle cx="${6 + i * 10}" cy="4" r="3" fill="${c}"/>`).join("");
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="8" viewBox="0 0 28 8">${dots}</svg>`)}`;
}

// 大量節點時的圖譜（#254）：泡泡是類型色 2px 邊框、類型色 12% 的淡底，中間是實體數與群組名稱（fonts.display），下方是類型組成的小點；
// 第 2、3 層的其他群組縮成 60px、75% 不透明。聚合線標上「N 段」（fonts.mono、surface 底）。
// 細節層：直接關係用 primary 加粗並標上關係名稱，二度關聯 45% 不透明、虛線
function zoomRules(v: (name: string) => string, types: TypeStyle[], dark: boolean): StylesheetJson {
  const tint = (color: string) => (dark ? mix(color, DARK_ENTITY_MIX, v("--color-text")) : color);
  return [
    {
      selector: "node.bubble",
      style: {
        label: "data(label)",
        shape: "ellipse",
        "font-family": v("--font-display"),
        "font-size": 13,
        "text-valign": "center",
        "text-margin-y": 0,
        "text-max-width": "96px",
        "text-background-opacity": 0,
        "background-opacity": 0.12,
        "background-image": "data(dots)",
        "background-width": "28px",
        "background-height": "8px",
        "background-position-y": "88%",
        "border-width": 2,
        "border-color": tint(v("--color-graphFallback")),
      },
    },
    ...types.map((t) => ({ selector: `node.bubble[type = "${t.id}"]`, style: { "background-color": tint(t.color), "border-color": tint(t.color) } })),
    { selector: "node.side", style: { opacity: SIDE_BUBBLE_OPACITY, "font-size": 10 } },
    {
      selector: "edge.aggregate",
      style: { label: "data(label)", "target-arrow-shape": "none", "font-size": 10, "font-family": v("--font-mono") },
    },
    { selector: "node.unlabelled", style: { label: "" } },
    { selector: "edge.direct", style: { label: "data(label)", width: 4, "line-color": v("--color-primary"), "target-arrow-color": v("--color-primary") } },
    { selector: ".second", style: { opacity: SECOND_OPACITY } },
    { selector: "edge.second", style: { "line-style": "dashed" } },
  ];
}

// 展示模式的字級（docs/design.md「展示模式」的「字級與主題」）：從 app.css 的 --present-* 讀出，一般模式時讀不到（空字串）
export interface PresentSizes {
  // 節點標籤（18px）與選取的實體（26px）
  label: number;
  selected: number;
  // 關係名稱、聚合線與側邊泡泡等小字（「虛構資料」標示的 16px，展示模式不用更小的字）
  small: number;
}

export function presentSizes(v: (name: string) => string): PresentSizes | null {
  const [label, selected, small] = ["--present-graph-label", "--present-graph-selected", "--present-label"].map((name) => parseFloat(v(name)));
  return [label, selected, small].every((n) => Number.isFinite(n) && n > 0) ? { label, selected, small } : null;
}

// 展示模式的標籤是畫面上的大小（#260 PR 3 審查）：cytoscape 的字級是 model 單位、隨 zoom 放大，
// 所以字級、截斷寬度、與節點的距離、襯底與外框都除以目前的 zoom；GraphView 的 keepLabelSize() 在縮放時重新計算
type Zoomed<T> = (ele: { cy(): { zoom(): number } }) => T;
export const onScreen =
  (px: number): Zoomed<number> =>
  (ele) =>
    px / ele.cy().zoom();
// 只接受長度字串的屬性（text-max-width、text-background-padding）
const onScreenPx =
  (px: number): Zoomed<string> =>
  (ele) =>
    `${px / ele.cy().zoom()}px`;

// 展示模式（#260）：節點標籤與選取的實體放大，截斷的寬度依字級等比例放大（graph-labels.ts 以 12px、112px 截斷，比例不變）；
// 選取實體以外的節點（others）28% 不透明，滑過時恢復；選取的關係用 primary 加粗並標上關係名稱
function presentationRules(v: (name: string) => string, size: PresentSizes): StylesheetJson {
  const width = (fontSize: number, base: number) => onScreenPx((base * fontSize) / NODE_LABEL_FONT_SIZE);
  const primary = { "line-color": v("--color-primary"), "target-arrow-color": v("--color-primary") };
  const padding = { "text-background-padding": onScreenPx(2) };
  return [
    {
      selector: "node",
      style: { "font-size": onScreen(size.label), "text-max-width": width(size.label, NODE_LABEL_MAX_WIDTH), "text-margin-y": onScreen(6), ...padding, "text-outline-width": onScreen(2) },
    },
    { selector: "node.bubble", style: { "font-size": onScreen(size.label), "text-max-width": width(size.label, 96), "text-margin-y": 0 } },
    { selector: "node.side", style: { "font-size": onScreen(size.small) } },
    // 關係名稱與一般模式相同：只有 surface 襯底、沒有外框（一般模式的 edge 沒有設 text-outline-color，
    // 給了外框寬度就會畫成 cytoscape 預設的黑色粗框，#260 PR 3 第 2 次審查）
    { selector: "edge", style: { "font-size": onScreen(size.small), ...padding } },
    { selector: "node.selected", style: { "font-size": onScreen(size.selected), "text-max-width": width(size.selected, NODE_LABEL_MAX_WIDTH) } },
    { selector: "node.others", style: { opacity: PRESENT_OTHERS_OPACITY } },
    { selector: "node.others.hover", style: { opacity: 1 } },
    { selector: "edge.near", style: { label: "data(label)", width: PRESENT_NEAR_WIDTH, ...primary } },
  ];
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
  const present = presentSizes(v);
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
    // 一般模式的關係名稱（#336，畫板 Graph）：text 色小字、surface 底加 1px border 的小標籤。
    // 展示模式維持原本的樣式（字級另由 presentationRules() 放大）；排在語意縮放的規則之前，聚合線的 fonts.mono 不受影響
    ...(present === null ? [{ selector: "edge", style: relationTag(v) }] : []),
    // 關係名稱只在選取節點的相連關係顯示
    { selector: "edge.near", style: { label: "data(label)" } },
    ...zoomRules(v, types, dark),
    // 變灰：不隱藏，保留整體輪廓，降到 45% 不透明（「只看它」之後 15%）。變灰的內容是背景，標籤對比刻意降低；
    // 滑過時恢復（最後的 hover），節點仍可點（#240 決定 3）
    { selector: ".dimmed", style: { opacity: DIMMED_OPACITY } },
    // 展示模式：放在變灰之後（28% 比 45% 更淡），「只看它」的 15% 與滑過、鍵盤的恢復之前
    ...(present === null ? [] : presentationRules(v, present)),
    { selector: ".dimmed.isolated", style: { opacity: ISOLATED_OPACITY } },
    // 選取（#336，畫板 Graph）：外面一圈 4px surface 間隙＋3px text 外環；展示模式維持 background 間隙＋2px text 外環
    {
      selector: "node.selected",
      style:
        present === null
          ? { "border-width": SELECTED_GAP, "border-color": v("--color-surface"), "border-position": "outside", "outline-width": SELECTED_RING, "outline-color": v("--color-text") }
          : { "border-width": 2, "border-color": v("--color-background"), "outline-width": 2, "outline-color": v("--color-text") },
    },
    // 找路徑的結果：路徑節點加 primary 外環，路徑上的線用 primary 加粗
    {
      selector: "node.path",
      style: { "border-width": 2, "border-color": v("--color-background"), "outline-width": 2, "outline-color": v("--color-primary") },
    },
    { selector: "edge.path", style: { width: 5, "line-color": v("--color-primary"), "target-arrow-color": v("--color-primary") } },
    // 滑過變灰的節點時恢復 100% 不透明，標籤在要讀的時候可讀（#240 決定 3）
    { selector: "node.dimmed.hover", style: { opacity: 1 } },
    // 剛展開（#336）：這一層展開才出現的節點，名稱下方標「剛展開」，標籤用 primary（展示模式不標）
    ...(present === null ? [{ selector: "node.fresh", style: { label: "data(freshLabel)", color: v("--color-primary"), "font-weight": 600 } }] : []),
    // 選取與滑過時顯示完整名稱（#288），疊在其他節點的標籤上面
    { selector: "node.selected, node.hover", style: { label: "data(label)", "z-index": 10 } },
    // 選取的名稱（#336）：text 底、surface 字的標籤（反白）。展示模式維持原本的樣式
    ...(present === null
      ? [
          {
            selector: "node.selected",
            style: {
              color: v("--color-surface"),
              "font-weight": 600,
              "text-background-color": v("--color-text"),
              "text-background-padding": "4px",
              "text-outline-width": 0,
            },
          },
        ]
      : []),
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
