// 結構測試：顏色與圓角一律來自 client/theme.json，app.css 與元件不寫死顏色值（docs/client-config.md「theme.json」）。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { sources, stripComments } from "../client/source-scan";
import design from "../../../docs/design.md?raw";
import checkClient from "../../../scripts/check-client.mjs?raw";
import css from "./app.css?raw";
import { graphStyle } from "./graph-style";
import { DARK_SCHEME, DARK_SELECTOR, followColorScheme, isDark, SCHEME_ATTRIBUTE, themeStyleSheet, themeVariables, watchColorScheme } from "./theme";

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
const ALLOWED_TOKEN = /^(?:-?\d*\.?\d+(?:px|rem|em|%|s)?|transparent|currentColor|inherit|none|inset|solid|dashed|dotted|underline)$/i;

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
    expect(Object.fromEntries(declarations(`${block};`))).toMatchObject({ "background-color": "var(--color-markReading)", color: "var(--color-readingText)" });
  });

  // 深色模式的 app.css 規則（引用標號所在的第一個 :root[data-scheme="dark"] { … } 的內容）
  const darkStart = cssText.indexOf(`${DARK_SELECTOR} {`);
  const darkCss = (() => {
    let depth = 0;
    for (let i = cssText.indexOf("{", darkStart); i < cssText.length; i++) {
      if (cssText[i] === "{") depth++;
      if (cssText[i] === "}" && --depth === 0) return cssText.slice(cssText.indexOf("{", darkStart) + 1, i);
    }
    return "";
  })();
  const lightCss = darkStart < 0 ? cssText : cssText.replace(`${DARK_SELECTOR} {${darkCss}}`, "");
  const rule = (text: string, selector: string) => {
    const block = text.match(new RegExp(`(?:^|[\\n}])\\s*${selector.replace(/[.[\]"=:()+]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1];
    expect(block, selector).toBeDefined();
    return Object.fromEntries(declarations(`${block};`));
  };
  const mix = (a: string, percent: number, b: string) => `color-mix(in srgb, var(--color-${a}) ${percent}%, var(--color-${b}))`;
  // 比例以 check:client 的 CITATION_MIX 為準（對比由它檢查）
  const ratio = (key: string) => Number(checkClient.match(new RegExp(`CITATION_MIX = \\{[^}]*\\b${key}: (\\d+)`))?.[1]);

  it("引用標號的三個狀態只用證據色系，內框與 Dark 的 hover 色比例與 check:client 相同", () => {
    expect(ratio("lightBorder")).toBeGreaterThan(0);
    const citation = 'button.citation, button.citation:hover, button.citation[aria-pressed="true"]'.split(", ");
    for (const selector of citation) {
      for (const value of [...Object.values(rule(lightCss, selector)), ...Object.values(rule(darkCss, selector))]) {
        expect(value).not.toContain("--color-primary");
      }
    }
    expect(rule(lightCss, "button.citation")).toMatchObject({
      "font-family": "var(--font-mono)",
      background: "var(--color-markSoft)",
      color: "var(--color-markText)",
      "box-shadow": `inset 0 0 0 1px ${mix("mark", ratio("lightBorder"), "markText")}`,
    });
    expect(rule(lightCss, "button.citation:hover")).toMatchObject({
      background: "var(--color-mark)",
      "box-shadow": `inset 0 0 0 1px ${mix("mark", ratio("lightHoverBorder"), "markText")}`,
    });
    expect(rule(lightCss, 'button.citation[aria-pressed="true"]')).toMatchObject({ background: "var(--color-text)", color: "var(--color-mark)" });
    expect(rule(darkCss, "button.citation")).toEqual({ "box-shadow": `inset 0 0 0 1px ${mix("mark", ratio("darkBorder"), "markSoft")}` });
    expect(rule(darkCss, "button.citation:hover")).toEqual({
      background: mix("mark", ratio("darkHoverBackground"), "markSoft"),
      color: mix("markReading", ratio("darkHoverText"), "text"),
      "box-shadow": "inset 0 0 0 1px var(--color-mark)",
    });
    expect(rule(darkCss, 'button.citation[aria-pressed="true"]')).toEqual({ background: "var(--color-mark)", color: "var(--color-markSoft)" });
  });

  it("原文放在 reading 紙面上", () => {
    expect(rule(lightCss, ".source-text")).toMatchObject({ background: "var(--color-reading)", color: "var(--color-readingText)" });
  });

  it("實體面板（#240）：原文片段在 reading 紙面、名稱用 markReading；類型徽章是類型色淡底與 text 字；數量用 fonts.mono", () => {
    expect(rule(lightCss, ".entity-excerpt")).toMatchObject({ background: "var(--color-reading)", color: "var(--color-readingText)" });
    expect(rule(lightCss, ".entity-excerpt mark")).toMatchObject({ "background-color": "var(--color-markReading)", color: "var(--color-readingText)" });
    expect(rule(lightCss, ".entity-badge")).toMatchObject({
      background: "color-mix(in srgb, var(--type-color) 14%, var(--color-surface))",
      color: "var(--color-text)",
    });
    expect(rule(lightCss, ".entity-counts")).toMatchObject({ "font-family": "var(--font-mono)" });
  });

  it("說法不同的標示只用 conflict 系列（conflict 在 surface 上、conflictText 在 conflictSoft 上）", () => {
    expect(rule(lightCss, ".passage-marks .badge")).toMatchObject({
      background: "var(--color-conflictSoft)",
      "border-color": "var(--color-conflict)",
      color: "var(--color-conflictText)",
    });
    expect(rule(lightCss, ".conflict-summary")).toMatchObject({ color: "var(--color-conflict)" });
    expect(rule(lightCss, ".conflict-side")).toMatchObject({ border: "1px solid var(--color-conflict)" });
    // 段落旁的標示不再個別用警告色
    expect(cssText).not.toMatch(/\.mark-(?:conflict|superseded_by|supersedes)\b/);
  });

  it("所有可聚焦元件有 :focus-visible 焦點框（2px focus、外推 2px），沒有規則取消焦點框", () => {
    expect(rule(lightCss, ":focus-visible")).toEqual({ outline: "2px solid var(--color-focus)", "outline-offset": "2px" });
    expect(cssText).not.toMatch(/outline(?:-style)?\s*:\s*(?:none|0)\s*;/);
  });

  it("表單元件用主題色，不用瀏覽器的系統控制項配色（#239）", () => {
    const fields = rule(lightCss, 'input:not([type="checkbox"], [type="radio"]),\nselect,\ntextarea');
    expect(fields).toMatchObject({
      "background-color": "var(--color-surface)",
      color: "var(--color-text)",
      border: "1px solid var(--color-border)",
    });
    expect(rule(lightCss, "input::placeholder,\ntextarea::placeholder")).toEqual({ color: "var(--color-textMuted)", opacity: "1" });
    // 停用時只降低不透明度，不換底色
    expect(rule(lightCss, ":is(input, select, textarea):disabled")).toEqual({ cursor: "default", opacity: "0.5" });
    expect(rule(lightCss, 'input[type="checkbox"],\ninput[type="radio"]')).toEqual({ "accent-color": "var(--color-primary)" });
    const select = rule(lightCss, "select");
    expect(select).toMatchObject({ appearance: "none" });
    expect(select["background-image"].match(/var\(--color-[\w-]+\)/g)).toEqual(Array(2).fill("var(--color-textMuted)"));
    // Dark 不覆寫表單元件：兩個模式都讀同一組變數
    expect(darkCss).not.toMatch(/\b(?:input|select|textarea)\b/);
  });

  it("檔案選擇：原生 input 視覺上隱藏但可聚焦，焦點框畫在自訂按鈕上（#239）", () => {
    const hidden = rule(lightCss, ".visually-hidden");
    expect(hidden).toMatchObject({ position: "absolute", width: "1px", height: "1px" });
    expect(hidden).not.toHaveProperty("display");
    expect(hidden).not.toHaveProperty("visibility");
    expect(rule(lightCss, ".file-picker input:focus-visible + .file-picker__button")).toEqual({
      outline: "2px solid var(--color-focus)",
      "outline-offset": "2px",
    });
  });

  it("--font-mono、--font-display 由 theme.json 提供", () => {
    expect(themeVariables(theme)).toMatchObject({ "--font-mono": theme.fonts.mono, "--font-display": theme.fonts.display });
  });
});

describe("深色模式", () => {
  const sheet = themeStyleSheet(clientConfig.theme);
  const [light, dark] = sheet.split(DARK_SELECTOR);

  it("淺色放在 :root，深色放在 :root[data-scheme=\"dark\"] 內，每個顏色都有", () => {
    expect(light).toContain("color-scheme: light;");
    for (const [name, value] of Object.entries(themeVariables(clientConfig.theme))) expect(light).toContain(`${name}: ${value};`);
    expect(dark).toContain("color-scheme: dark;");
    for (const [name, value] of Object.entries(clientConfig.theme.darkColors)) expect(dark).toContain(`--color-${name}: ${value};`);
    // 深色只換顏色，圓角與字型沿用
    expect(dark).not.toMatch(/--(?:radius|font)-/);
  });

  it("app.css 的深色規則都在 DARK_SELECTOR 內，不直接用 media query（切換時才能交叉淡換，#246）", () => {
    expect(cssText).not.toContain("prefers-color-scheme");
    expect(cssText.split(`${DARK_SELECTOR} {`).length - 1).toBe(3);
  });

  it("依系統設定標記 root；系統切換時把重新標記交給 change（交叉淡換），取消後不再通知", () => {
    const listeners = new Set<() => void>();
    const queries: string[] = [];
    const media = { matches: false };
    const fake = (query: string) => {
      queries.push(query);
      return {
        get matches() {
          return media.matches;
        },
        addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
      } as unknown as MediaQueryList;
    };
    const attributes = new Map<string, string>();
    const root = { setAttribute: (name: string, value: string) => attributes.set(name, value), getAttribute: (name: string) => attributes.get(name) ?? null };
    const changes: (() => void)[] = [];
    const stop = followColorScheme(fake, root, (apply) => changes.push(apply));
    expect(queries).toEqual([DARK_SCHEME]);
    expect(attributes.get(SCHEME_ATTRIBUTE)).toBe("light");
    media.matches = true;
    for (const fn of listeners) fn();
    // change 拿到套用的函式，套用之前不改標記
    expect(isDark(root)).toBe(false);
    changes[0]();
    expect(isDark(root)).toBe(true);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("標記改變後通知（圖譜重新套用配色），取消後停止", () => {
    const observed: unknown[] = [];
    let notify = () => {};
    let disconnected = false;
    class FakeObserver {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe(_target: unknown, options: unknown) {
        observed.push(options);
      }
      disconnect() {
        disconnected = true;
      }
    }
    let calls = 0;
    const stop = watchColorScheme({} as Node, () => calls++, FakeObserver as unknown as typeof MutationObserver);
    expect(observed).toEqual([{ attributes: true, attributeFilter: [SCHEME_ATTRIBUTE] }]);
    notify();
    expect(calls).toBe(1);
    stop();
    expect(disconnected).toBe(true);
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
