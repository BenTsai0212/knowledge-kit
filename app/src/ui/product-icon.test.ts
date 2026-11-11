// 產品 icon 與 favicon（#226，docs/design.md「產品 icon（K 晶格）」）
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ThemeFile } from "../client/types";
import { strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import icon16 from "../../../docs/images/icon/knowledge-kit-16.svg?raw";
import iconDark from "../../../docs/images/icon/knowledge-kit-dark.svg?raw";
import iconLight from "../../../docs/images/icon/knowledge-kit-light.svg?raw";
import indexHtml from "../../index.html?raw";
import favicon from "../../public/favicon.svg?raw";
import css from "./app.css?raw";
import { ICON_PATH, ProductIcon, SIMPLIFIED_MAX_SIZE } from "./ProductIcon";
import { BRAND_ICON_SIZE, Sidebar } from "./Sidebar";
import { themeVariables } from "./theme";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

// CSS 規則的宣告（選擇器完全相同的那一條）
function rule(text: string, selector: string): Record<string, string> {
  const block = text.match(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1];
  expect(block, selector).toBeDefined();
  return Object.fromEntries([...`${block};`.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));
}

// SVG 中各元素的屬性（依出現順序）
function elements(svg: string, tag: string): Record<string, string>[] {
  return [...svg.matchAll(new RegExp(`<${tag}\\b([^>]*)/?>`, "g"))].map((m) =>
    Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  );
}

const render = (size: number) => renderToStaticMarkup(createElement(ProductIcon, { size }));

describe("產品 icon 元件", () => {
  it("路徑與節點和 docs/images/icon/ 的 SVG 相同", () => {
    for (const svg of [iconLight, iconDark]) {
      expect(elements(svg, "path")[0].d).toBe(ICON_PATH);
      expect(elements(svg, "circle").map(({ cx, cy, r }) => [cx, cy, r])).toEqual([["17", "24", "3.5"], ["32", "34.5", "4.5"], ["32", "13.5", "4.5"]]);
    }
    expect(elements(icon16, "path")[0].d).toBe(ICON_PATH);

    const full = render(48);
    expect(elements(full, "path")[0]).toMatchObject({ d: ICON_PATH, "stroke-width": "3.5" });
    expect(elements(full, "circle").map(({ class: c, cx, cy, r }) => [c, cx, cy, r])).toEqual([
      ["product-icon__joint", "17", "24", "3.5"],
      ["product-icon__primary", "32", "34.5", "4.5"],
      ["product-icon__evidence", "32", "13.5", "4.5"],
    ]);
  });

  it("32px 以下用簡化版：線加粗、只留證據節點、不描邊（knowledge-kit-16.svg）", () => {
    const small = render(SIMPLIFIED_MAX_SIZE);
    const [line] = elements(small, "path");
    expect(line["stroke-width"]).toBe(elements(icon16, "path")[0]["stroke-width"]);
    expect(elements(small, "circle")).toEqual([
      expect.objectContaining({ class: "product-icon__evidence", cx: "32", cy: "13.5", r: elements(icon16, "circle")[0].r, "stroke-width": "0" }),
    ]);
    expect(render(SIMPLIFIED_MAX_SIZE + 1)).toContain("product-icon__primary");
  });

  it("裝飾用：aria-hidden，沒有自己的文字", () => {
    const svg = elements(render(48), "svg")[0];
    expect(svg).toMatchObject({ "aria-hidden": "true", focusable: "false" });
    expect(svg).not.toHaveProperty("aria-label");
    expect(render(48)).not.toMatch(/<title/);
  });

  it("顏色只讀 token：線條 text、下方節點 primary、證據節點 mark", () => {
    expect(rule(cssText, ".product-icon__line")).toMatchObject({ stroke: "var(--color-text)" });
    expect(rule(cssText, ".product-icon__joint")).toMatchObject({ fill: "var(--color-text)" });
    expect(rule(cssText, ".product-icon__primary")).toMatchObject({ fill: "var(--color-primary)" });
    expect(rule(cssText, ".product-icon__evidence")).toMatchObject({ fill: "var(--color-mark)", stroke: "var(--color-markText)" });
  });
});

// 換客戶時，主色節點跟著 primary 改變、證據節點不變（ADR 0008：證據色客戶不能改）
describe("換成 clients/ 的示範客戶", () => {
  const demos = Object.entries(import.meta.glob<ThemeFile>("../../../clients/*/theme.json", { eager: true, import: "default" }));
  const themes: [string, ThemeFile][] = [["client", clientConfig.theme], ...demos];

  it("有示範客戶可以比較", () => {
    expect(demos.length).toBeGreaterThan(0);
  });

  it("主色節點的顏色（--color-primary）每個客戶都不同，證據節點（--color-mark）都相同", () => {
    for (const pick of [(t: ThemeFile) => t.colors, (t: ThemeFile) => t.darkColors]) {
      const vars = themes.map(([, t]) => themeVariables({ ...t, colors: pick(t) }));
      expect(new Set(vars.map((v) => v["--color-primary"])).size, "primary").toBe(themes.length);
      expect(new Set(vars.map((v) => v["--color-mark"])), "mark").toEqual(new Set([vars[0]["--color-mark"]]));
    }
  });
});

describe("頁首的組合字標", () => {
  const html = (language: string) =>
    renderToStaticMarkup(
      createElement(Sidebar, {
        language,
        identity: clientConfig.access.roles[0].id,
        onIdentity: () => {},
        onLanguage: () => {},
        views: ["qa"],
        view: "qa",
        onView: () => {},
        questions: [],
        onQuestion: () => {},
      }),
    );

  it("icon＋產品名稱＋客戶顯示名稱，文字來自 i18n 與 client.json", () => {
    for (const language of clientConfig.client.languages) {
      const h1 = html(language).match(/<h1 class="brand">([\s\S]*?)<\/h1>/)?.[1] ?? "";
      expect(h1).toContain('class="product-icon"');
      expect(h1).toContain(`<span class="brand__wordmark">${strings(language).productName}</span>`);
      expect(h1).toContain(`<span class="brand__client">${clientConfig.client.displayName[language]}</span>`);
    }
    expect(BRAND_ICON_SIZE).toBeGreaterThan(SIMPLIFIED_MAX_SIZE);
  });

  it("字標用 fonts.display，客戶名稱前有分隔線", () => {
    expect(rule(cssText, ".brand__wordmark")).toMatchObject({ "font-family": "var(--font-display)" });
    expect(rule(cssText, ".brand__client")).toMatchObject({ "border-left": "1px solid var(--color-border)" });
  });
});

describe("favicon", () => {
  it("index.html 指向 favicon.svg", () => {
    expect(indexHtml).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/);
  });

  it("形狀與 knowledge-kit-16.svg 相同", () => {
    for (const tag of ["path", "circle"]) {
      const pick = ({ d, cx, cy, r, "stroke-width": w }: Record<string, string>) => ({ d, cx, cy, r, w });
      expect(elements(favicon, tag).map(pick), tag).toEqual(elements(icon16, tag).map(pick));
    }
    expect(elements(favicon, "rect")[0]).toMatchObject({ rx: "11", "stroke-width": "2" });
  });

  it("Light 的顏色與 knowledge-kit-16.svg 相同，Dark 依 prefers-color-scheme 改用 Dark 的 token", () => {
    const [light, dark] = favicon.split("@media (prefers-color-scheme: dark)");
    expect(dark).toBeDefined();
    const [rect] = elements(icon16, "rect");
    const [line] = elements(icon16, "path");
    const [node] = elements(icon16, "circle");
    expect(rule(light, ".tile")).toEqual({ fill: rect.fill, stroke: rect.stroke });
    expect(rule(light, ".line")).toEqual({ stroke: line.stroke });
    expect(rule(light, ".evidence")).toEqual({ fill: node.fill });
    const d = clientConfig.theme.darkColors;
    expect(rule(dark, ".tile")).toEqual({ fill: d.surface, stroke: d.border });
    expect(rule(dark, ".line")).toEqual({ stroke: d.text });
    expect(rule(dark, ".evidence")).toEqual({ fill: d.mark });
  });
});
