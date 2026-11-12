// 展示模式的字級、主題與隱藏（#260 PR 1，docs/design.md「展示模式」）。實際的字級與隱藏的元素以 E2E（e2e/presentation.spec.ts）確認
import { describe, expect, it } from "vitest";
import css from "./app.css?raw";
import { markPresentation, MODE_ATTRIBUTE } from "./online-demo";
import { retrievalNotice, showsAsDot } from "./retrieval-notice";
import { DARK_SCHEME, SCHEME_ATTRIBUTE, startColorScheme } from "./theme";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");
const PRESENT = ':root[data-mode="presentation"]';

// 頂層的規則（展示模式的規則寫成完整的選擇器，不巢狀）：選擇器與宣告的本文
const rules = () => [...cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, " "), body: m[2] }));
const variables = () => {
  const root = rules().find((r) => r.selector === PRESENT);
  return Object.fromEntries([...(root?.body ?? "").matchAll(/(--[-\w]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
// 宣告中的 property: value
const declaration = (selector: string, property: string) => {
  const rule = rules().find((r) => r.selector === selector);
  return rule?.body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`))?.[1].trim();
};

describe("字級表（docs/design.md「字級與主題」）", () => {
  // 圖譜節點標籤畫在 cytoscape 上，由 graph-style.ts 處理（#260 PR 3）
  const table: [string, string, string, string][] = [
    ["內文、清單", "body", "font-size", "20px"],
    ["問題泡泡", ".answer > h2", "font-size", "36px"],
    ["問題泡泡（粗細）", ".answer > h2", "font-weight", "700"],
    ["回答", ".answer-text", "font-size", "28px"],
    ["回答（行高）", ".answer-text", "line-height", "1.7"],
    ["引用標號（高）", "button.citation", "height", "36px"],
    ["原文面板", ".source-text", "font-size", "22px"],
    ["頁籤、身分、按鈕（高）", ":is(button:not(.link, .citation), select, .primary-tabs button)", "min-height", "56px"],
    ["「虛構資料」「展示用權限」", ":is(.badge, .access-badge)", "font-size", "16px"],
    ["原文面板的寬", "main.qa > .source", "width", "min(620px, 100vw)"],
  ];

  it.each(table)("%s：展示模式時以 --present-* 變數設定", (_name, selector, property, expected) => {
    const value = declaration(`${PRESENT} ${selector}`, property);
    expect(value).toMatch(/var\(--present-[-\w]+\)/);
    const vars = variables();
    const resolved = value!.replace(/var\((--present-[-\w]+)\)/g, (_m, name: string) => vars[name]);
    expect(resolved).toBe(expected);
  });

  it("--present-* 只在展示模式的區塊定義與使用，一般模式的規則不讀", () => {
    for (const { selector, body } of rules()) {
      if (!/--present-/.test(body)) continue;
      expect(selector.startsWith(PRESENT), selector).toBe(true);
    }
    expect(cssText.match(/--present-[-\w]+\s*:/g)?.length).toBe(Object.keys(variables()).length);
  });

  it("展示模式不覆蓋顏色 token", () => {
    for (const { selector, body } of rules()) {
      if (selector.startsWith(PRESENT)) expect(body, selector).not.toMatch(/--color-[-\w]+\s*:/);
    }
  });
});

describe("根元素的標記", () => {
  const fakeRoot = () => {
    const attributes = new Map<string, string>();
    return { attributes, setAttribute: (name: string, value: string) => void attributes.set(name, value) };
  };

  it("展示模式時加 data-mode=\"presentation\"，一般模式不加", () => {
    const presentation = fakeRoot();
    markPresentation(presentation, true);
    expect(presentation.attributes.get(MODE_ATTRIBUTE)).toBe("presentation");
    const normal = fakeRoot();
    markPresentation(normal, false);
    expect(normal.attributes.has(MODE_ATTRIBUTE)).toBe(false);
  });

  it("展示模式固定 Light，不查詢也不跟隨系統設定；一般模式依系統設定", () => {
    const queries: string[] = [];
    const matchMedia = (query: string) => {
      queries.push(query);
      return { matches: true, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList;
    };
    const presentation = fakeRoot();
    startColorScheme(true, matchMedia, presentation, (apply) => apply())();
    expect(queries).toEqual([]);
    expect(presentation.attributes.get(SCHEME_ATTRIBUTE)).toBe("light");

    const normal = fakeRoot();
    startColorScheme(false, matchMedia, normal, (apply) => apply())();
    expect(queries).toEqual([DARK_SCHEME]);
    expect(normal.attributes.get(SCHEME_ATTRIBUTE)).toBe("dark");
  });
});

describe("語意模型的準備提示（展示模式縮成小點）", () => {
  const loading = retrievalNotice(true, { state: "preparing", progress: null });
  const downloading = retrievalNotice(true, { state: "preparing", progress: { loaded: 10, total: 100 } });
  const ready = retrievalNotice(true, { state: "ready", fallback: null });

  it("展示模式：載入中與下載中是小點，完成後消失", () => {
    expect(showsAsDot(loading, true)).toBe(true);
    expect(showsAsDot(downloading, true)).toBe(true);
    expect(ready).toBeNull();
    expect(showsAsDot(ready, true)).toBe(false);
  });

  it("一般模式照常顯示完整的提示", () => {
    expect(showsAsDot(loading, false)).toBe(false);
    expect(showsAsDot(downloading, false)).toBe(false);
  });
});
