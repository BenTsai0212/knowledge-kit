import { describe, expect, it } from "vitest";
import knowledgeModelSchema from "../../../client/schema/knowledge-model.schema.json";
import { ENTITY_ICONS, iconDataUri } from "./entity-icons";

describe("實體類型的圖示集", () => {
  it("Schema 的 icon enum 與圖示集的名稱相同", () => {
    const icon = knowledgeModelSchema.properties.entityTypes.items.properties.icon;
    expect([...icon.enum].sort()).toEqual(Object.keys(ENTITY_ICONS).sort());
    expect(icon.default).toBe("generic");
  });

  it("每個圖示是 24×24 範圍內的 path，彼此不同", () => {
    const paths = Object.values(ENTITY_ICONS);
    expect(new Set(paths).size).toBe(paths.length);
    for (const d of paths) expect(d).toMatch(/^M[\d\s.,MmLlHhVvAaCcZz-]+$/);
  });

  it("iconDataUri() 以指定的顏色著色", () => {
    const uri = iconDataUri("person", "#3D7AB8");
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    const svg = decodeURIComponent(uri.slice("data:image/svg+xml;utf8,".length));
    expect(svg).toContain('fill="#3D7AB8"');
    expect(svg).toContain(`d="${ENTITY_ICONS.person}"`);
    expect(svg).toContain('width="24" height="24"');
  });
});
