// 結構測試：顏色與圓角一律來自 client/theme.json，app.css 與元件不寫死顏色值（docs/client-config.md「theme.json」）。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { sources, stripComments } from "../client/source-scan";
import design from "../../../docs/design.md?raw";
import css from "./app.css?raw";
import { graphStyle } from "./graph-style";
import { DARK_SCHEME, themeStyleSheet, themeVariables, watchColorScheme } from "./theme";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

// 寫死的顏色值：#hex、rgb()／rgba()、hsl()／hsla()、hwb()、lab()、lch()、oklab()、oklch()、color()
const COLOR_VALUE = /#[0-9A-Fa-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

// CSS 的色名（常用的）；元件中以字串出現就算寫死
const COLOR_NAMES = [
  "white", "black", "red", "green", "blue", "yellow", "orange", "purple", "pink", "brown",
  "gray", "grey", "silver", "gold", "navy", "teal", "maroon", "olive", "lime", "aqua", "fuchsia", "cyan", "magenta",
];
const NAMED_COLOR = new RegExp(`["'\`](?:${COLOR_NAMES.join("|")})["'\`]`, "i");

// 帶顏色的屬性；自訂屬性（--*）也算，因為它可能被當成顏色使用
const COLOR_PROPERTY = /^(?:--[\w-]+|color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|text-decoration(?:-color)?|caret-color|accent-color|fill|stroke)$/;

// 顏色屬性的值去掉 var(...)、color-mix(in srgb, ...) 之後，只能剩下這些字
const ALLOWED_TOKEN = /^(?:-?\d*\.?\d+(?:px|rem|em|%|s)?|transparent|currentColor|inherit|none|solid|dashed|dotted|underline)$/i;

function declarations(text: string): Array<[string, string]> {
  return [...text.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]);
}

function leftovers(value: string): string[] {
  return value
    .replace(/var\(--[\w-]+\)/g, " ")
    .replace(/color-mix\(\s*in\s+srgb\s*,/g, " ")
    .replace(/[(),]/g, " ")
    .split(/\s+/)
    .filter((t) => t !== "" && !ALLOWED_TOKEN.test(t));
}

describe("主題的結構", () => {
  it("app.css 沒有寫死的顏色值", () => {
    expect(cssText.match(new RegExp(COLOR_VALUE, "g")) ?? []).toEqual([]);
  });

  it("app.css 帶顏色的屬性只由 CSS 變數、color-mix 與少數關鍵字組成", () => {
    const decls = declarations(cssText).filter(([prop]) => COLOR_PROPERTY.test(prop));
    expect(decls.length).toBeGreaterThan(20);
    expect(decls.filter(([, value]) => leftovers(value).length > 0)).toEqual([]);
  });

  it("檢查本身：寫死的顏色會被抓到", () => {
    expect(leftovers("1px solid red")).toEqual(["red"]);
    expect(leftovers("color-mix(in srgb, var(--color-danger) 14%, var(--color-surface))")).toEqual([]);
    expect(leftovers("0 4px 16px color-mix(in srgb, var(--color-overlay) 38%, transparent)")).toEqual([]);
    expect(COLOR_VALUE.test("background: #fff3bf")).toBe(true);
    expect(COLOR_VALUE.test("rgb(0 0 0 / 40%)")).toBe(true);
    expect(NAMED_COLOR.test('{ color: "White" }')).toBe(true);
    expect(NAMED_COLOR.test('className="white-space"')).toBe(false);
  });

  it("app.css 用到的 --color-*、--radius-*、--font-* 都由 theme.json 提供", () => {
    const defined = new Set(Object.keys(themeVariables(clientConfig.theme)));
    const used = new Set([...cssText.matchAll(/var\((--(?:color|radius|font)-[\w-]+)\)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
    // 主題的每個顏色都有 CSS 變數
    for (const name of Object.keys(clientConfig.theme.colors)) expect(defined.has(`--color-${name}`)).toBe(true);
  });

  // 「回答提到」與「接著問」（#198）：文字與底色只用 check:client 檢查過對比的組合
  // （text 在 surface 上；選取時 text 在主色 12% 的淡色底上，外框是 primary）
  it("淺色外框按鈕只用檢查過對比的顏色組合", () => {
    const rule = (selector: string) => {
      const block = cssText.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1];
      expect(block, selector).toBeDefined();
      return Object.fromEntries(declarations(`${block};`));
    };
    expect(rule("button.chip")).toMatchObject({ color: "var(--color-text)", background: "var(--color-surface)" });
    expect(rule('button.chip[aria-pressed="true"]')).toMatchObject({
      border: "2px solid var(--color-primary)",
      background: "color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))",
    });
    // 色點的顏色來自 knowledge-model.json 的 color（與 surface 的對比 ≥ 3:1 由 check:client 檢查）
    expect(rule(".type-dot")).toMatchObject({ background: "var(--type-color)" });
  });

  it("元件與模組沒有寫死的顏色值或色名", () => {
    expect(sources.map(([p]) => p)).toContain("../ui/GraphView.tsx");
    const found = sources
      .filter(([, text]) => {
        const code = stripComments(text);
        return COLOR_VALUE.test(code) || NAMED_COLOR.test(code);
      })
      .map(([p]) => p);
    expect(found).toEqual([]);
  });
});

// 參考情境的 token 與設計規格（docs/design.md「顏色 token」「字體、圓角、焦點框」）逐鍵相同（#225）
describe("設計系統 v1", () => {
  const { theme } = clientConfig;

  it("colors／darkColors 的每個鍵都與 design.md 的表格相同", () => {
    const rows = [...design.matchAll(/^\| `(\w+)` \| [^|]+ \| `(#[0-9A-F]+)` \| `(#[0-9A-F]+)` \|/gm)];
    expect(Object.fromEntries(rows.map((m) => [m[1], m[2]]))).toEqual(theme.colors);
    expect(Object.fromEntries(rows.map((m) => [m[1], m[3]]))).toEqual(theme.darkColors);
  });

  it("字體與圓角與 design.md 相同", () => {
    const fonts = [...design.matchAll(/^\| `fonts\.(\w+)`(?:（新增）)? \| `([^`]+)`/gm)];
    expect(Object.fromEntries(fonts.map((m) => [m[1], m[2]]))).toEqual(theme.fonts);
    const radius = design.match(/^\| `radius` \| (.+) \|$/m)?.[1] ?? "";
    expect(Object.fromEntries([...radius.matchAll(/(small|medium|large|pill) (\d+px)/g)].map((m) => [m[1], m[2]]))).toEqual(theme.radius);
  });

  it("原文螢光放在亮色紙面的組合上（readingText 在 markReading 上，check:client 檢查對比）", () => {
    const block = cssText.match(/\.source \.highlight mark\s*\{([^}]*)\}/)?.[1];
    expect(Object.fromEntries(declarations(`${block};`))).toMatchObject({ background: "var(--color-markReading)", color: "var(--color-readingText)" });
  });
});

describe("深色模式", () => {
  const sheet = themeStyleSheet(clientConfig.theme);
  const [light, dark] = sheet.split(`@media ${DARK_SCHEME}`);

  it("淺色放在 :root，深色放在 prefers-color-scheme: dark 內，每個顏色都有", () => {
    expect(light).toContain("color-scheme: light dark;");
    for (const [name, value] of Object.entries(themeVariables(clientConfig.theme))) expect(light).toContain(`${name}: ${value};`);
    expect(dark).toBeDefined();
    for (const [name, value] of Object.entries(clientConfig.theme.darkColors)) expect(dark).toContain(`--color-${name}: ${value};`);
    // 深色只換顏色，圓角與字型沿用
    expect(dark).not.toMatch(/--(?:radius|font)-/);
  });

  it("系統切換淺色／深色時通知，取消後不再通知", () => {
    const listeners = new Set<() => void>();
    const queries: string[] = [];
    const fake = (query: string) => {
      queries.push(query);
      return {
        addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
      } as unknown as MediaQueryList;
    };
    let calls = 0;
    const stop = watchColorScheme(fake, () => calls++);
    expect(queries).toEqual([DARK_SCHEME]);
    for (const fn of listeners) fn();
    expect(calls).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("圖譜的配色只讀 theme.json 提供的變數，切換時讀到的值跟著改變", () => {
    const read = new Set<string>();
    const style = (colors: Record<string, string>) =>
      graphStyle((name) => {
        read.add(name);
        return { ...themeVariables(clientConfig.theme), ...Object.fromEntries(Object.entries(colors).map(([k, v]) => [`--color-${k}`, v])) }[name] ?? "";
      }, clientConfig.knowledgeModel.entityTypes);
    const [lightStyle, darkStyle] = [style({}), style({ ...clientConfig.theme.darkColors })];
    const defined = new Set(Object.keys(themeVariables(clientConfig.theme)));
    expect([...read].filter((name) => !defined.has(name))).toEqual([]);
    const nodeColor = (s: ReturnType<typeof graphStyle>) => JSON.stringify(s).match(/"color":"([^"]+)"/)?.[1];
    expect(nodeColor(lightStyle)).toBe(clientConfig.theme.colors.text);
    expect(nodeColor(darkStyle)).toBe(clientConfig.theme.darkColors.text);
  });
});
