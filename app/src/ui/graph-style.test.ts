import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { iconDataUri } from "./entity-icons";
import { edgeWidth, graphStyle, mix, nodeSize, SELECTED_NODE_TINT } from "./graph-style";
import { themeVariables } from "./theme";

const variables = themeVariables(clientConfig.theme);
// graphStyle() 只產生 { selector, style } 形式的規則
const style = graphStyle((name) => variables[name] ?? "", clientConfig.knowledgeModel.entityTypes) as {
  selector: string;
  style: Record<string, unknown>;
}[];
const rule = (selector: string) => style.find((r) => r.selector === selector)?.style;

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

  it("節點是白底（surface）圓形，大小與線粗來自資料", () => {
    expect(rule("node")).toMatchObject({
      shape: "ellipse",
      width: "data(size)",
      height: "data(size)",
      "background-color": clientConfig.theme.colors.surface,
    });
    expect(rule("edge")).toMatchObject({ width: "data(width)" });
  });

  it("每種實體類型：類型色的外圈與圖示；選取時是類型色的淡色底、圖示改用 text", () => {
    const { surface, text } = clientConfig.theme.colors;
    for (const t of clientConfig.knowledgeModel.entityTypes) {
      const selector = `node[type = "${t.id}"]`;
      expect(rule(selector)).toEqual({ "border-color": t.color, "background-image": iconDataUri(t.icon, t.color) });
      expect(rule(`${selector}.selected`)).toEqual({
        "background-color": mix(t.color, SELECTED_NODE_TINT, surface),
        "background-image": iconDataUri(t.icon, text),
      });
    }
  });

  it("找不到類型時用 graphFallback 與通用圖示", () => {
    const fallback = clientConfig.theme.colors.graphFallback;
    const generic = style.filter((r) => r.selector === "node").map((r) => r.style);
    expect(generic).toContainEqual({ "border-color": fallback, "background-image": iconDataUri("generic", fallback) });
  });
});
