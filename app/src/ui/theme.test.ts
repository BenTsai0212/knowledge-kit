// 結構測試：顏色與圓角一律來自 client/theme.json，app.css 與元件不寫死顏色值（docs/client-config.md「theme.json」）。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { sources, stripComments } from "../client/source-scan";
import css from "./app.css?raw";
import { themeVariables } from "./theme";

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
