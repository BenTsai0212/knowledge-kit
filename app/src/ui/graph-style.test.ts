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
  mix,
  NODE_LABEL_MAX_WIDTH,
  NODE_SHAPES,
  nodeSize,
} from "./graph-style";
import graphView from "./GraphView.tsx?raw";
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

  it("選取：background 間隙＋2px text 外環，不用淡色底或陰影", () => {
    expect(rule("node.selected")).toEqual({ "border-width": 2, "border-color": colors.background, "outline-width": 2, "outline-color": colors.text });
    expect(JSON.stringify(style)).not.toMatch(/underlay/);
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

  it("連線用 border 加深一階的顏色；關係名稱用 fonts.mono 小字、surface 底", () => {
    const edgeColor = mix(colors.border, EDGE_MIX, colors.text);
    expect(rule("edge")).toMatchObject({
      "line-color": edgeColor,
      "target-arrow-color": edgeColor,
      "font-family": clientConfig.theme.fonts.mono,
      "text-background-color": colors.surface,
      "text-background-opacity": 1,
    });
    expect(rule("edge", darkStyle)).toMatchObject({ "line-color": mix(darkColors.border, EDGE_MIX, darkColors.text) });
  });

  it("找路徑的結果：路徑上的線用 primary 加粗，路徑節點加 primary 外環", () => {
    expect(rule("edge.path")).toEqual({ width: 5, "line-color": colors.primary, "target-arrow-color": colors.primary });
    expect(rule("node.path")).toMatchObject({ "outline-color": colors.primary, "border-color": colors.background });
  });

  it("不畫任何「有內容被隱藏」的痕跡：沒有虛線框或上鎖的樣式", () => {
    expect(JSON.stringify(style)).not.toMatch(/dashed|dotted|lock|hidden/);
  });
});
