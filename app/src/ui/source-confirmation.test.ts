// 原文面板的來源確認（ADR 0013 決定 8、9，#417 PR 3）：能確認的身分才看到按鈕，「確認這段」只在標示的出處段落；已確認時只顯示角色與日期；
// 失效時顯示說明與打開另一段的連結；措辭是「這段原文已確認」，外觀不用 success 綠或勾勾
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings, TRANSLATIONS } from "../client/i18n";
import { clientConfig } from "../client/load";
import type { PassageConfirmation } from "../sources/confirmations";
import type { SourceDocument } from "../sources/source";
import css from "./app.css?raw";
import { roleLabel } from "./ReportResult";
import { SourceConfirmation } from "./SourceConfirmation";
import { SourceText } from "./SourceText";

const language = clientConfig.client.defaultLanguage;
const s = strings(language);
const manager = clientConfig.access.roles.find((r) => r.canReview)!.id;
const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const noop = () => {};
const write = () => Promise.resolve();

const confirmed = (status: PassageConfirmation["status"]): PassageConfirmation => ({ confirmedBy: manager, confirmedAt: "2026-11-18T08:00:00Z", status });
const render = (confirmation: PassageConfirmation | undefined, canConfirm: boolean) =>
  renderToStaticMarkup(createElement(SourceConfirmation, { language, confirmation, onConfirm: canConfirm ? write : undefined, onOpenSource: noop }));

describe("SourceConfirmation", () => {
  it("未確認：不能確認的身分什麼都看不到；能確認的身分看到「確認這段」", () => {
    expect(render(undefined, false)).toBe("");
    const html = render(undefined, true);
    expect(html).toContain(escape(s.sourceConfirm));
    expect(html).not.toContain(escape(s.sourceConfirmed));
  });

  it("已確認（有效）：「這段原文已確認」與「〈角色〉於〈日期〉確認」；只有能確認的身分看到「撤銷確認」", () => {
    const html = render(confirmed({ kind: "valid" }), false);
    expect(html).toContain(escape(s.sourceConfirmed));
    expect(html).toContain(escape(roleLabel(manager, language)));
    expect(html).toContain(`aria-label="${escape(s.sourceConfirmGroup)}"`);
    expect(html).not.toContain(escape(s.sourceConfirmRevoke));
    expect(html).not.toContain("<button");
    expect(render(confirmed({ kind: "valid" }), true)).toContain(escape(s.sourceConfirmRevoke));
  });

  it("失效：被取代時連到新的一段；有不同說法時連到另一段", () => {
    const superseded = render(confirmed({ kind: "superseded", passageId: "p-new" }), false);
    expect(superseded).toContain(escape(s.sourceConfirmedSuperseded));
    expect(superseded).toContain(escape(s.sourceConfirmOpenNewer));
    const disputed = render(confirmed({ kind: "disputed", passageId: "p-other" }), false);
    expect(disputed).toContain(escape(s.sourceConfirmedDisputed));
    expect(disputed).toContain(escape(s.sourceConfirmOpenOther));
    expect(disputed).not.toContain(escape(s.sourceConfirmed) + "<");
  });

  it("外觀：不用 success 綠；文字沒有勾勾", () => {
    const rules = cssText.match(/\.source-confirm[\w-]*[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(/--color-success/);
    for (const [lang, t] of Object.entries(TRANSLATIONS)) {
      const texts = Object.entries(t).filter(([k]) => k.startsWith("sourceConfirm"));
      expect(texts.length, lang).toBe(10);
      for (const [k, v] of texts) expect(v, `${lang} ${k}`).not.toMatch(/[✓✔☑]/);
    }
  });

  it("措辭界線（ADR 0013 決定 9）：不說「答案已確認」或「已驗證」", () => {
    for (const [k, v] of Object.entries(TRANSLATIONS["zh-TW"] ?? {})) {
      if (k.startsWith("sourceConfirm")) expect(v, k).not.toMatch(/答案已確認|回答已確認|已驗證/);
    }
    for (const [k, v] of Object.entries(TRANSLATIONS.en ?? {})) {
      if (k.startsWith("sourceConfirm")) expect(v, k).not.toMatch(/answer|verified/i);
    }
  });
});

describe("SourceText 的來源確認", () => {
  // 第 1 段已確認，第 2、3 段未確認；highlight 是這次打開的出處段落（螢光標示）
  const source = (confirmable: boolean, highlight: string): SourceDocument => ({
    id: "doc",
    title: "文件",
    language,
    visibility: "public",
    project: null,
    passages: [
      { id: "p-1", content: "第一段", marks: [], confirmation: confirmed({ kind: "valid" }) },
      { id: "p-2", content: "第二段", marks: [] },
      { id: "p-3", content: "第三段", marks: [] },
    ],
    highlight,
    ...(confirmable ? { confirmable } : {}),
  });
  const html = (confirmable: boolean, numbered: boolean, highlight: string) =>
    renderToStaticMarkup(createElement(SourceText, { language, source: source(confirmable, highlight), onOpenSource: noop, numbered, onConfirm: write }));
  const button = (text: string) => `>${escape(text)}<`;
  const count = (out: string, text: string) => out.split(button(text)).length - 1;

  it("不能確認時：只顯示已確認的段落，沒有任何按鈕", () => {
    for (const numbered of [false, true]) {
      const out = html(false, numbered, "p-2");
      expect(out.split(escape(s.sourceConfirmed)).length - 1).toBe(1);
      expect(count(out, s.sourceConfirm)).toBe(0);
      expect(out).not.toContain(escape(s.sourceConfirmRevoke));
    }
  });

  it("能確認時：「確認這段」只在標示的段落下方，換出處時跟著走；沒有標示的段落沒有", () => {
    for (const numbered of [false, true]) {
      for (const [highlight, own, next] of [
        ["p-2", "第二段", "第三段"],
        ["p-3", "第三段", null],
      ] as const) {
        const out = html(true, numbered, highlight);
        expect(count(out, s.sourceConfirm), `${highlight} numbered=${numbered}`).toBe(1);
        const at = out.indexOf(button(s.sourceConfirm));
        expect(at).toBeGreaterThan(out.indexOf(own));
        if (next !== null) expect(at).toBeLessThan(out.indexOf(next));
      }
    }
  });

  it("能確認時：沒有標示但已確認的段落仍顯示確認紀錄與「撤銷確認」", () => {
    for (const numbered of [false, true]) {
      const out = html(true, numbered, "p-2");
      expect(out).toContain(escape(s.sourceConfirmed));
      expect(count(out, s.sourceConfirmRevoke)).toBe(1);
      // 第 1 段的下方（第二段之前）
      expect(out.indexOf(button(s.sourceConfirmRevoke))).toBeLessThan(out.indexOf("第二段"));
    }
  });

  it("標示的段落已確認時：沒有「確認這段」，只有「撤銷確認」", () => {
    for (const numbered of [false, true]) {
      const out = html(true, numbered, "p-1");
      expect(count(out, s.sourceConfirm)).toBe(0);
      expect(count(out, s.sourceConfirmRevoke)).toBe(1);
    }
  });
});
