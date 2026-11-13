import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { iconDataUri } from "./entity-icons";
import { heroShape } from "./entry-hero";
import {
  DARK_ENTITY_MIX,
  DIMMED_OPACITY,
  EDGE_MIX,
  edgeWidth,
  graphStyle,
  ISOLATED_OPACITY,
  KEYBOARD_RING,
  mix,
  NODE_LABEL_MAX_WIDTH,
  NODE_SHAPES,
  nodeSize,
  PRESENT_OTHERS_OPACITY,
  presentSizes,
  SELECTED_GAP,
  SELECTED_RING,
} from "./graph-style";
import css from "./app.css?raw";
import graphView from "./GraphView.tsx?raw";
import zoomView from "./GraphZoomView.tsx?raw";
import { themeVariables } from "./theme";

const variables = themeVariables(clientConfig.theme);
const darkVariables = themeVariables({ ...clientConfig.theme, colors: clientConfig.theme.darkColors });
type Rules = { selector: string; style: Record<string, unknown> }[];
// graphStyle() 只產生 { selector, style } 形式的規則
const build = (vars: Record<string, string>, dark: boolean) =>
  graphStyle((name) => vars[name] ?? "", clientConfig.knowledgeModel.entityTypes, 0, dark) as Rules;
const style = build(variables, false);
const darkStyle = build(darkVariables, true);
const rule = (selector: string, rules: Rules = style) => {
  const found = rules.filter((r) => r.selector === selector).map((r) => r.style);
  return found.length === 0 ? undefined : Object.assign({}, ...found);
};
const { colors, darkColors } = clientConfig.theme;

describe("圖譜的節點與線（#199）", () => {
  it("節點大小隨關聯數變大，有上限", () => {
    expect(nodeSize(0)).toBe(32);
    expect(nodeSize(1)).toBeLessThan(nodeSize(3));
    expect(nodeSize(8)).toBe(64);
    expect(nodeSize(50)).toBe(64);
  });

  it("線粗隨出處數變粗，有上限", () => {
    expect(edgeWidth(1)).toBe(1.75);
    expect(edgeWidth(0)).toBe(edgeWidth(1));
    expect(edgeWidth(2)).toBeGreaterThan(edgeWidth(1));
    expect(edgeWidth(20)).toBe(edgeWidth(5));
  });

  it("mix() 與 CSS 的 color-mix(in srgb) 相同", () => {
    expect(mix("#000000", 50, "#FFFFFF")).toBe("#808080");
    expect(mix("#3D7AB8", 100, "#FFFFFF")).toBe("#3d7ab8");
    expect(mix("#3D7AB8", 0, "#FFFFFF")).toBe("#ffffff");
  });

  it("大小與線粗來自資料", () => {
    expect(rule("node")).toMatchObject({ width: "data(size)", height: "data(size)" });
    expect(rule("edge")).toMatchObject({ width: "data(width)" });
  });

  it("長的節點標籤換行，以不透明的面板底色襯底，不壓到連線（#207）", () => {
    expect(rule("node")).toMatchObject({
      color: colors.text,
      "text-wrap": "wrap",
      "text-max-width": `${NODE_LABEL_MAX_WIDTH}px`,
      "text-background-color": colors.surface,
      "text-background-opacity": 1,
    });
    // 深色模式：GraphView 以切換後的 CSS 變數重新套用，襯底跟著換成深色的 surface
    expect(rule("node", darkStyle)).toMatchObject({ color: darkColors.text, "text-background-color": darkColors.surface });
  });
});

describe("圖譜套用設計系統 v1（#240）", () => {
  it("節點是「形狀＋填色」：形狀與入口頁主視覺一致，Light 填類型色、Dark 調亮，圖示是 surface 色", () => {
    for (const t of clientConfig.knowledgeModel.entityTypes) {
      const selector = `node[type = "${t.id}"]`;
      const shape = NODE_SHAPES[heroShape(t.icon)];
      expect(rule(selector)).toEqual({ ...shape, "background-color": t.color, "background-image": iconDataUri(t.icon, colors.surface) });
      expect(rule(selector, darkStyle)).toEqual({
        ...shape,
        "background-color": mix(t.color, DARK_ENTITY_MIX, darkColors.text),
        "background-image": iconDataUri(t.icon, darkColors.surface),
      });
    }
  });

  it("人員圓形、部門圓角方形、專案小圓角方形", () => {
    const shapeOf = (id: string) => {
      const { shape, "corner-radius": radius } = rule(`node[type = "${id}"]`)!;
      return { shape, radius };
    };
    expect(shapeOf("person")).toEqual({ shape: "ellipse", radius: undefined });
    const [team, project] = [shapeOf("team"), shapeOf("project")];
    expect([team.shape, project.shape]).toEqual(["round-rectangle", "round-rectangle"]);
    expect(parseFloat(team.radius as string)).toBeGreaterThan(parseFloat(project.radius as string));
  });

  it("找不到類型時用 graphFallback、圓形與通用圖示", () => {
    expect(style.filter((r) => r.selector === "node").map((r) => r.style)).toContainEqual({
      shape: "ellipse",
      "background-color": colors.graphFallback,
      "background-image": iconDataUri("generic", colors.surface),
    });
  });

  it("選取：4px surface 間隙＋3px text 外環，名稱是 text 底、surface 字的標籤；不用淡色底或陰影（#336）", () => {
    expect([SELECTED_GAP, SELECTED_RING]).toEqual([4, 3]);
    expect(rule("node.selected")).toEqual({
      "border-width": 4,
      "border-color": colors.surface,
      "border-position": "outside",
      "outline-width": 3,
      "outline-color": colors.text,
      color: colors.surface,
      "font-weight": 600,
      "text-background-color": colors.text,
      "text-background-padding": "4px",
      "text-outline-width": 0,
    });
    expect(rule("node.selected", darkStyle)).toMatchObject({ color: darkColors.surface, "text-background-color": darkColors.text });
    expect(JSON.stringify(style)).not.toMatch(/underlay/);
  });

  it("剛展開（#336）：名稱下方標「剛展開」、primary；排在選取與滑過之前，選取或滑過時顯示完整名稱", () => {
    expect(rule("node.fresh")).toEqual({ label: "data(freshLabel)", color: colors.primary, "font-weight": 600 });
    const order = (selector: string) => style.findIndex((r) => r.selector === selector);
    expect(order("node.fresh")).toBeLessThan(order("node.selected, node.hover"));
    expect(graphView).toContain("freshLabel");
  });

  it("變灰：45% 不透明，「只看它」之後 15%；滑過時恢復 100%；不縮小、不換色", () => {
    expect(rule(".dimmed")).toEqual({ opacity: DIMMED_OPACITY });
    expect(rule(".dimmed.isolated")).toEqual({ opacity: ISOLATED_OPACITY });
    expect([DIMMED_OPACITY, ISOLATED_OPACITY]).toEqual([0.45, 0.15]);
    // 滑過的規則排在變灰之後，cytoscape 以後面的規則為準
    const order = (selector: string) => style.findIndex((r) => r.selector === selector);
    expect(rule("node.dimmed.hover")).toEqual({ opacity: 1 });
    expect(order("node.dimmed.hover")).toBeGreaterThan(order(".dimmed.isolated"));
    expect(style.filter((r) => r.selector.includes("dimmed")).map((r) => Object.keys(r.style))).toEqual([["opacity"], ["opacity"], ["opacity"]]);
    // GraphView 在滑過節點時加上 hover，離開時移除
    expect(graphView).toContain('instance.on("mouseover", "node", (e) => e.target.addClass("hover"))');
    expect(graphView).toContain('instance.on("mouseout", "node", (e) => e.target.removeClass("hover"))');
  });

  it("連線用 border 加深一階的顏色；關係名稱是 text 色小字、surface 底加 1px border 的小標籤（#336）", () => {
    const edgeColor = mix(colors.border, EDGE_MIX, colors.text);
    expect(rule("edge")).toMatchObject({
      "line-color": edgeColor,
      "target-arrow-color": edgeColor,
      "font-family": clientConfig.theme.fonts.body,
      "font-size": 11,
      color: colors.text,
      "text-background-color": colors.surface,
      "text-background-opacity": 1,
      "text-border-width": 1,
      "text-border-color": colors.border,
    });
    // 聚合線的「N 段」仍是 fonts.mono（排在後面）
    expect(rule("edge.aggregate")).toMatchObject({ "font-family": clientConfig.theme.fonts.mono });
    expect(rule("edge", darkStyle)).toMatchObject({ "line-color": mix(darkColors.border, EDGE_MIX, darkColors.text) });
  });

  it("找路徑的結果：路徑上的線用 primary 加粗，路徑節點加 primary 外環", () => {
    expect(rule("edge.path")).toEqual({ width: 5, "line-color": colors.primary, "target-arrow-color": colors.primary });
    expect(rule("node.path")).toMatchObject({ "outline-color": colors.primary, "border-color": colors.background });
  });

  it("不畫任何「有內容被隱藏」的痕跡：沒有虛線框或上鎖的樣式（鍵盤游標的虛線圈、細節層看得到的二度關聯除外，#289、#254）", () => {
    expect(JSON.stringify(style.filter((r) => r.selector !== "node.kb-cursor" && r.selector !== "edge.second"))).not.toMatch(/dashed|dotted|lock|hidden/);
  });
});

describe("鍵盤操作的標示（#289）", () => {
  it("目前的實體是 focus 色 3px 實線圈，游標是虛線圈；Light／Dark 都用 focus", () => {
    expect(KEYBOARD_RING).toBe(3);
    for (const [rules, palette] of [[style, colors], [darkStyle, darkColors]] as const) {
      expect(rule("node.kb-current", rules)).toMatchObject({ "outline-width": 3, "outline-style": "solid", "outline-color": palette.focus });
      expect(rule("node.kb-cursor", rules)).toMatchObject({ "outline-width": 3, "outline-style": "dashed", "outline-color": palette.focus });
    }
  });

  it("連到目前實體的線加粗成 primary 並標出關係名稱；鍵盤標示的元素不變灰", () => {
    expect(rule("edge.kb-near")).toEqual({ label: "data(label)", width: 4, "line-color": colors.primary, "target-arrow-color": colors.primary, opacity: 1 });
    expect(rule("node.kb-current, node.kb-cursor")).toMatchObject({ opacity: 1 });
    // 排在變灰之後，蓋過變灰的不透明度
    const order = (selector: string) => style.findIndex((r) => r.selector === selector);
    expect(order("edge.kb-near")).toBeGreaterThan(order(".dimmed.isolated"));
    expect(order("node.kb-current, node.kb-cursor")).toBeGreaterThan(order(".dimmed.isolated"));
  });

  it("圖上畫截斷名稱（#288），選取、滑過與鍵盤的目前實體／游標顯示完整名稱", () => {
    expect(rule("node")).toMatchObject({ label: "data(shortLabel)" });
    expect(rule("node.selected, node.hover")).toMatchObject({ label: "data(label)", "z-index": 10 });
    expect(rule("node.kb-current, node.kb-cursor")).toEqual({ opacity: 1, label: "data(label)", "z-index": 10 });
  });
});

describe("展示模式的圖譜（#260，docs/design.md「展示模式」）", () => {
  // app.css 中展示模式的 --present-*（getComputedStyle 在展示模式讀得到的值）
  const block = css.match(/:root\[data-mode="presentation"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  const present = Object.fromEntries([...block.matchAll(/(--present-[-\w]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const presentStyle = build({ ...variables, ...present }, false);
  const order = (selector: string, rules: Rules = presentStyle) => rules.findIndex((r) => r.selector === selector);

  // 展示模式的字級是畫面上的大小：值是依 zoom 換算的函式（model 單位 = 畫面 px ÷ zoom）
  const at = (zoom: number) => ({ cy: () => ({ zoom: () => zoom }) });
  const onScreen = (value: unknown, zoom = 1) => {
    const result = typeof value === "function" ? (value as (ele: ReturnType<typeof at>) => unknown)(at(zoom)) : value;
    return typeof result === "string" ? parseFloat(result) * zoom : (result as number) * zoom;
  };

  it("字級表：節點標籤 18px、選取的實體 26px，關係名稱等小字 16px；截斷的寬度等比例放大", () => {
    expect(presentSizes((name) => present[name] ?? "")).toEqual({ label: 18, selected: 26, small: 16 });
    expect(onScreen(rule("node", presentStyle)["font-size"])).toBe(18);
    expect(onScreen(rule("node", presentStyle)["text-max-width"])).toBe((NODE_LABEL_MAX_WIDTH * 18) / 12);
    expect(onScreen(rule("node.selected", presentStyle)["font-size"])).toBe(26);
    expect(onScreen(rule("edge", presentStyle)["font-size"])).toBe(16);
    // 展示模式不用小於 16px 的字（docs/design.md 原則 1）：展示模式的規則（變灰與「只看它」之間）都至少 16px；
    // 它們排在所有設定字級的一般規則之後（cytoscape 以後面的規則為準），涵蓋節點、泡泡、側邊泡泡、關係名稱與聚合線
    const [start, end] = [order(".dimmed") + 1, order(".dimmed.isolated")];
    const sizes = presentStyle.slice(start, end).flatMap((r) => (r.style["font-size"] === undefined ? [] : [onScreen(r.style["font-size"])]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
    expect(presentStyle.slice(end).every((r) => r.style["font-size"] === undefined)).toBe(true);
    expect(["node", "node.bubble", "node.side", "edge", "edge.aggregate"].every((sel) => presentStyle.slice(start, end).some((r) => sel.startsWith(r.selector)))).toBe(true);
  });

  it("標籤在畫面上的大小不隨 zoom 改變：字級、截斷寬度、與節點的距離、襯底與外框都除以 zoom（#260 PR 3 審查）", () => {
    const node = rule("node", presentStyle);
    for (const zoom of [0.5, 1, 2.5]) {
      expect(onScreen(node["font-size"], zoom)).toBeCloseTo(18);
      expect(onScreen(node["text-max-width"], zoom)).toBeCloseTo(168);
      expect(onScreen(node["text-margin-y"], zoom)).toBeCloseTo(6);
      expect(onScreen(node["text-background-padding"], zoom)).toBeCloseTo(2);
      expect(onScreen(node["text-outline-width"], zoom)).toBeCloseTo(2);
      expect(onScreen(rule("node.selected", presentStyle)["font-size"], zoom)).toBeCloseTo(26);
      expect(onScreen(rule("edge", presentStyle)["font-size"], zoom)).toBeCloseTo(16);
    }
    // 群組泡泡的名稱在泡泡中央
    expect(rule("node.bubble", presentStyle)["text-margin-y"]).toBe(0);
    // 縮放時重新計算樣式（GraphView 與 GraphZoomView 都呼叫），排版時把標籤算進節點的大小
    expect(graphView).toContain('cy.on("zoom", () => cy.style().update())');
    expect(graphView).toContain("nodeDimensionsIncludeLabels: presenting()");
    expect(graphView.match(/keepLabelSize\(instance\)/g)?.length).toBe(1);
    expect(zoomView).toContain("keepLabelSize(instance)");
    // 選取後由 presentFocus() 決定視角（presentation-camera.test.ts）
    expect(graphView).toContain("presentFocus(cy, eles, selectedOf(next), panMs)");
  });

  it("選取實體以外的節點 28% 不透明：排在變灰（45%）之後、「只看它」（15%）與滑過、鍵盤的恢復之前", () => {
    expect(PRESENT_OTHERS_OPACITY).toBe(0.28);
    expect(rule("node.others", presentStyle)).toEqual({ opacity: 0.28 });
    expect(rule("node.others.hover", presentStyle)).toEqual({ opacity: 1 });
    expect(order("node.others")).toBeGreaterThan(order(".dimmed"));
    expect(order("node.others")).toBeLessThan(order(".dimmed.isolated"));
    expect(order("node.others")).toBeLessThan(order("node.kb-current, node.kb-cursor"));
    // GraphView（鄰近圖除外）與 GraphZoomView 在有選取時把其他實體標上 others
    expect(graphView).toContain('cy.nodes().filter((n) => n.id() !== selected).addClass("others")');
    expect(graphView).toContain("markSelected(instance, graph, selected, !compact)");
    expect(zoomView).toContain("others: selected !== null && id !== selected");
  });

  it("一般模式的選取外環、反白名稱、加框的關係名稱與「剛展開」不套用（#336：展示模式的圖譜不變）", () => {
    expect(rule("node.selected", presentStyle)).toMatchObject({ "border-width": 2, "border-color": colors.background, "outline-width": 2, "outline-color": colors.text });
    expect(rule("node.selected", presentStyle)["text-background-color"]).toBeUndefined();
    expect(rule("node.fresh", presentStyle)).toBeUndefined();
    expect(rule("edge", presentStyle)["text-border-width"]).toBeUndefined();
    expect(rule("edge", presentStyle)["font-family"]).toBe(clientConfig.theme.fonts.mono);
  });

  it("選取的關係用 primary 加粗並標上關係名稱", () => {
    expect(rule("edge.near", presentStyle)).toMatchObject({ label: "data(label)", width: 5, "line-color": colors.primary, "target-arrow-color": colors.primary });
  });

  it("關係名稱與一般模式相同：surface 襯底、沒有深色外框，襯底在畫面上 2px（#260 PR 3 第 2 次審查）", () => {
    // edge.near 實際套用的樣式：依序合併所有適用於關係（edge、edge.near）的規則，後面的為準
    const applied = (rules: Rules) => Object.assign({}, ...rules.filter((r) => r.selector === "edge" || r.selector === "edge.near").map((r) => r.style));
    const [normal, presenting] = [applied(style), applied(presentStyle)];
    for (const label of [normal, presenting]) {
      expect(label["text-background-color"]).toBe(colors.surface);
      expect(label["text-background-opacity"]).toBe(1);
      // 沒有外框；有外框時必須是背景色（cytoscape 預設是黑色）
      if (label["text-outline-width"] !== undefined) expect(label["text-outline-color"]).toBe(colors.background);
    }
    for (const zoom of [0.5, 1, 2.5]) {
      expect(onScreen(presenting["text-outline-width"] ?? 0, zoom)).toBeLessThanOrEqual(3);
      expect(onScreen(presenting["text-background-padding"], zoom)).toBeCloseTo(2);
    }
    // 整份樣式中，給了外框寬度的規則都有背景色的外框（節點的基本規則）
    const outlined = presentStyle.filter((r) => r.style["text-outline-width"] !== undefined).map((r) => r.selector);
    expect(outlined.every((selector) => selector.startsWith("node"))).toBe(true);
    expect(rule("node", presentStyle)["text-outline-color"]).toBe(colors.background);
  });

  it("一般模式不變：讀不到 --present-* 時沒有展示模式的規則，字級 12px", () => {
    expect(presentSizes((name) => variables[name] ?? "")).toBeNull();
    // 一般模式多了加框的關係名稱、剛展開與反白的選取名稱（#336）
    expect(style.length).toBe(presentStyle.length - 8 + 3);
    expect(rule("node")).toMatchObject({ "font-size": 12 });
    expect(rule("node.others")).toBeUndefined();
    expect(rule("edge.near")).toEqual({ label: "data(label)" });
  });
});
