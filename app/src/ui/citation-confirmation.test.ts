// 回答的引用標號的小標記（ADR 0013 決定 8、9，#417 PR 4）：只在引用到已確認而且有效的段落時加小圓點與 aria-label；
// 外觀是文字色（currentColor）的圓點，不用 success 綠或勾勾；措辭是「這段原文已確認」
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill, strings, TRANSLATIONS } from "../client/i18n";
import { clientConfig } from "../client/load";
import type { Answer } from "../qa/answer";
import css from "./app.css?raw";
import { AnswerView, type AnswerState } from "./AnswerView";

const language = clientConfig.client.defaultLanguage;
const s = strings(language);
const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const noop = () => {};

const answer: Answer = { kind: "answer", text: "甲[1]。乙[2]。丙[3]。", numbering: ["p-1", "p-2", "p-3"], cited: ["p-1", "p-2", "p-3"], dropped: [], uncited: false, incomplete: false };
let turn = 0;
const render = (confirmed: string[] | undefined) => {
  const state: AnswerState = { question: "問題", streaming: "", answer, ...(confirmed === undefined ? {} : { confirmed }) };
  return renderToStaticMarkup(
    createElement(AnswerView, {
      id: `citation-confirmation-${turn++}`,
      language,
      state,
      canUpload: false,
      onOpenSource: noop,
      openPassage: null,
      onGotoUpload: noop,
      onOpenEntity: noop,
      openEntity: null,
      readReport: () => Promise.resolve(null),
      onRetry: noop,
      retryDisabled: false,
      onShorten: noop,
      onDraft: noop,
      onViewInGraph: noop,
    }),
  );
};
const buttons = (html: string) => html.match(/<button[^>]*class="citation[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];

describe("引用標號的小標記", () => {
  it("引用到已確認（有效）的段落：class、aria-label「引用 N，這段原文已確認」與裝飾的圓點；其他標號不變", () => {
    const [one, two, three] = buttons(render(["p-2"]));
    expect(two).toContain('class="citation citation--confirmed"');
    expect(two).toContain(`aria-label="${escape(fill(s.citationConfirmed, { n: 2 }))}"`);
    expect(two).toContain('<span class="citation__confirmed" aria-hidden="true"></span>');
    // 滑過的提示：說明圓點的意思，與 aria-label 的後半一致
    expect(two).toContain(`title="${escape(s.citationConfirmedHint)}"`);
    expect(fill(s.citationConfirmed, { n: 2 }).endsWith(s.citationConfirmedHint)).toBe(true);
    for (const b of [one, three]) {
      expect(b).toContain('class="citation"');
      expect(b).not.toContain("aria-label");
      expect(b).not.toContain("citation__confirmed");
      expect(b).toContain(`title="${escape(s.openSource)}"`);
    }
  });

  it("沒有確認或讀取失敗（confirmed 沒有值）時沒有任何痕跡", () => {
    for (const html of [render([]), render(undefined)]) {
      expect(buttons(html)).toHaveLength(3);
      expect(html).not.toContain("citation--confirmed");
      expect(html).not.toContain(escape(fill(s.citationConfirmed, { n: 1 })));
      // 提示照舊是「打開原文」，沒有「這段原文已確認」
      expect(html).not.toContain(escape(s.citationConfirmedHint));
      for (const b of buttons(html)) expect(b).toContain(`title="${escape(s.openSource)}"`);
    }
  });

  it("外觀：圓點是文字色（currentColor），不用 success 綠", () => {
    const rules = cssText.match(/[^{}]*citation(--|__)confirmed[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const rule of rules) expect(rule).not.toMatch(/--color-success/);
    expect(rules.find((r) => r.includes(".citation__confirmed"))).toMatch(/background:\s*currentColor/);
  });

  it("措辭（ADR 0013 決定 9）：不說「答案已確認」或「已驗證」，沒有勾勾；各語言都有數字的位置", () => {
    for (const [lang, t] of Object.entries(TRANSLATIONS)) {
      const { citationConfirmed: text, citationConfirmedHint: hint } = t as { citationConfirmed?: string; citationConfirmedHint?: string };
      if (text === undefined) continue;
      expect(text, lang).toContain("{n}");
      expect(text, lang).not.toMatch(/[✓✔☑]|答案已確認|回答已確認|已驗證|answer|verified/i);
      // 提示與 aria-label 的後半一致（大小寫不計：英文在句中是小寫）
      expect(hint, lang).toBeDefined();
      expect(hint!, lang).not.toMatch(/[✓✔☑]|答案已確認|回答已確認|已驗證|answer|verified/i);
      expect(text.toLowerCase().endsWith(hint!.toLowerCase()), lang).toBe(true);
    }
    expect(s.citationConfirmed).toContain("這段原文已確認");
  });
});
