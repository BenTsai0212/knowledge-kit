// 「已直接收錄 N 項」（ADR 0011 決定 5，畫板 docs/design/v1/boards/S-Review.dc.html 的 .auto、.sbtn、.arow、.rc、.done）：
// 卡片內 border 細框的方塊、15px／700 的標題、40px 的外框按鈕、每列上方的分隔線、36px 的撤回按鈕與理由膠囊。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill, strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import css from "./app.css?raw";
import { AutoApproved } from "./AutoApproved";
import type { AutoItem } from "./seam-review";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

// CSS 規則的宣告（選擇器完全相同、不在 @media 中的那一條）
function rule(selector: string): Record<string, string> {
  const block = cssText.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]()"=:>]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1];
  expect(block, selector).toBeDefined();
  return Object.fromEntries([...`${block};`.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const language = clientConfig.client.defaultLanguage;
const s = strings(language);
const item = (id: string): AutoItem => ({ kind: "entity", item: { id } as AutoItem["item"] }) as AutoItem;

describe("已直接收錄的外觀（S-Review）", () => {
  it("預設收合：標題、說明與兩個按鈕，沒有列", () => {
    const html = renderToStaticMarkup(
      createElement(AutoApproved, {
        language,
        active: [item("a"), item("b")],
        retracted: [item("c")],
        busy: false,
        row: () => null,
        detail: () => null,
        onRetract: () => {},
      }),
    );
    expect(html).toContain('class="review-auto"');
    expect(html).toContain('class="review-auto__title"');
    expect(html).toContain(fill(s.seamAutoSection, { count: 2 }, language));
    expect(html).toContain(`<span class="review-auto__retracted">${fill(s.seamAutoRetractedCount, { count: 1 }, language)}</span>`);
    expect(html).toContain(`<p class="review-auto__hint">${s.seamAutoHint}</p>`);
    expect(html.match(/<button type="button" class="secondary"/g)).toHaveLength(2);
    expect(html).not.toContain("review-auto__item");
  });

  it("方塊：1px border、圓角 12、padding 14；桌機與卡片邊緣隔開", () => {
    expect(rule(".review-doc .review-auto")).toMatchObject({
      border: "1px solid var(--color-border)",
      "border-radius": "12px",
      padding: "14px",
    });
    expect(rule(".review-page--desktop .review-doc .review-auto")).toMatchObject({ margin: "0 20px 20px" });
  });

  it("標題 15px／700，說明是 textMuted", () => {
    expect(rule(".review-auto__title")).toMatchObject({ "font-size": "15px", "font-weight": "700", color: "var(--color-text)" });
    expect(rule(".review-auto__retracted,\n.review-auto__hint,\n.review-auto__reasons-title")).toMatchObject({ color: "var(--color-textMuted)" });
  });

  it("按鈕 40px 外框，列內的撤回 36px；每列上方 1px 分隔線", () => {
    expect(rule(".review-page .review-doc .review-auto button.secondary")).toMatchObject({ height: "40px", border: "1px solid var(--color-border)" });
    expect(rule(".review-doc .review-auto .review-row button.secondary")).toMatchObject({ height: "36px" });
    expect(rule(".review-auto__item")).toMatchObject({ "border-top": "1px solid var(--color-border)" });
  });

  it("撤回理由是 36px 的膠囊，選中時 text 底、surface 字", () => {
    expect(rule(".review-doc .review-auto button.review-auto__reason")).toMatchObject({
      height: "36px",
      "border-radius": "var(--radius-pill)",
      background: "var(--color-surface)",
    });
    expect(rule('.review-doc .review-auto button.review-auto__reason[aria-pressed="true"]')).toMatchObject({
      background: "var(--color-text)",
      color: "var(--color-surface)",
    });
  });

  it("已撤回是 border 細框的膠囊，不用錯誤色", () => {
    const mark = rule(".review-doc .review-auto .review-mark.is-retracted");
    expect(mark).toMatchObject({ border: "1px solid var(--color-border)", color: "var(--color-textMuted)" });
    expect(Object.values(mark).join(" ")).not.toMatch(/danger|conflict|success/);
  });
});
