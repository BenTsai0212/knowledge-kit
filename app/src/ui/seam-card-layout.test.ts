// 待審頁的接縫卡片對齊畫板（#378 PR 4c，docs/design/v1/boards/S-Review.dc.html 的 .opt、.opt.skip、.rel、.expl label）：
// 選項是 14px 一般字重（桌機的列內按鈕規則不蓋過）、出口是 textMuted、「跟著這一項一起決定」的關係只有文字、說明的標題靠左
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill, strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import css from "./app.css?raw";
import { AskCard } from "./AskCard";
import { entityTypeLabel } from "./graph-labels";
import requestAsk from "./RequestAsk.tsx?raw";
import reviewPage from "./ReviewPage.tsx?raw";
import { SeamItem } from "./SeamItem";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

// CSS 規則的宣告（選擇器完全相同、不在 @media 中的那一條）
function rule(selector: string): Record<string, string> {
  const block = cssText.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]()"=:>]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1];
  expect(block, selector).toBeDefined();
  return Object.fromEntries([...`${block};`.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const language = clientConfig.client.defaultLanguage;
const s = strings(language);

describe("接縫卡片的選項（S-Review 的 .opt）", () => {
  it("桌機：44px、圓角 10、14px 一般字重，蓋過列內按鈕的 40px／700", () => {
    expect(rule(".review-page--desktop .review-doc button")).toMatchObject({ height: "40px", "font-weight": "700" });
    expect(rule(".review-page--desktop .review-doc .ask-card .refusal-ask__options button")).toMatchObject({
      height: "auto",
      "min-height": "44px",
      "border-radius": "10px",
      "font-size": "14px",
      "font-weight": "400",
    });
    // 寫在列內按鈕的規則之後（權重較高，順序也在後）
    expect(cssText.indexOf(".review-page--desktop .review-doc .ask-card .refusal-ask__options button")).toBeGreaterThan(
      cssText.indexOf(".review-page--desktop .review-doc button {"),
    );
  });

  it("出口（都不是，我來說明）是 textMuted 字", () => {
    expect(rule(".review-doc .ask-card .refusal-ask__options button.refusal-ask__skip")).toMatchObject({ color: "var(--color-textMuted)" });
    const html = renderToStaticMarkup(
      createElement(AskCard, { language, title: s.seamTitle, question: "q", options: [{ key: "a", label: "A", onChoose: () => {} }], onExplain: () => {} }),
    );
    expect(html).toContain(`<button type="button" class="refusal-ask__skip">${s.commonExplain}</button>`);
  });
});

describe("請上傳者確認（S-Review 的出口、.held、.reply，S-Request）", () => {
  const card = (props: Partial<Parameters<typeof AskCard>[0]>) =>
    renderToStaticMarkup(
      createElement(AskCard, { language, title: s.seamTitle, question: "q", options: [{ key: "a", label: "A", onChoose: () => {} }], onExplain: () => {}, ...props }),
    );

  it("出口「我不確定，請上傳者確認」排在「都不是，我來說明」之後，同樣是 textMuted", () => {
    const html = card({ exits: [{ key: "request", label: s.seamRequest, onChoose: () => {} }] });
    const explain = `<button type="button" class="refusal-ask__skip">${s.commonExplain}</button>`;
    const request = `<button type="button" class="refusal-ask__skip">${s.seamRequest}</button>`;
    expect(html.indexOf(request)).toBeGreaterThan(html.indexOf(explain));
  });

  it("已請上傳者確認：不顯示選項與「輪到你」，改顯示膠囊與說明", () => {
    const html = card({ held: createElement("span", { className: "ask-card__pill" }, s.seamHeld) });
    expect(html).toContain(s.seamHeld);
    expect(html).not.toContain("refusal-ask__options");
    expect(html).not.toContain(s.commonYourTurn);
    expect(rule(".ask-card__pill")).toMatchObject({ height: "26px", "border-radius": "999px", background: "var(--color-surfaceRaised)", "font-weight": "700" });
    expect(rule(".ask-card__reply")).toMatchObject({ background: "var(--color-surfaceRaised)", "border-radius": "10px" });
    expect(rule(".ask-card__reply-meta")).toMatchObject({ color: "var(--color-textMuted)" });
  });

  it("上傳者的「輪到你」說明回答只是說明", () => {
    const turn = "turn-text";
    expect(card({ turn })).toContain(`<p class="refusal-ask__turn">${turn}</p>`);
  });
});

describe("跟著這一項一起決定的關係（S-Review 的 .rel）", () => {
  it("只有文字：小標 12px textMuted，關係 13px；沒有自己的按鈕", () => {
    expect(rule(".ask-card__rel")).toMatchObject({ display: "flex", "flex-direction": "column", "font-size": "13px" });
    expect(rule(".ask-card__rel-title")).toMatchObject({ "font-size": "12px", color: "var(--color-textMuted)" });
    const block = reviewPage.slice(reviewPage.indexOf('<div className="ask-card__rel">'), reviewPage.indexOf("</AskCard>"));
    expect(block).toContain("s.seamRelations");
    expect(block).not.toContain("<button");
    expect(block).not.toContain("relationRow(");
  });
});

describe("「都不是，我來說明」的說明欄（S-Review 的 .expl label）", () => {
  it("標題靠左：蓋過全域 label 的 align-items: center", () => {
    expect(rule("label")["align-items"]).toBe("center");
    expect(rule(".ask-card__explain label")).toMatchObject({ "flex-direction": "column", "align-items": "stretch" });
  });
});

describe("手機的接縫卡（S-Review 手機，#400）", () => {
  it("手機：接縫的列沒有外框與內距；其他列與桌機、平板照舊", () => {
    expect(rule(".review-page--phone .review-seams > li")).toMatchObject({ border: "0", padding: "0" });
    expect(rule(".review-list > li")).toMatchObject({ border: "1px solid var(--color-border)" });
    // 接縫的列在 review-seams 的列表中
    expect(reviewPage).toContain(`<ul className="review-list review-seams">`);
  });
});

describe("接縫卡的項目列（S-Review ①、S-Request 的 .item，#400）", () => {
  const type = clientConfig.knowledgeModel.entityTypes[0];
  const item = (props: Partial<Parameters<typeof SeamItem>[0]>) => renderToStaticMarkup(createElement(SeamItem, { language, name: "名稱", ...props }));

  it("依序是類型膠囊（色點＋類型名稱）、粗體名稱、其他語言名稱、「出處（N）」文字連結", () => {
    const html = item({ entityType: type.id, nameLanguage: "zh-TW", others: [{ language: "en", text: "Other" }], sources: { count: 2, open: false, onToggle: () => {} } });
    const order = ['class="ask-card__kind', 'class="type-dot"', entityTypeLabel(type.id, language), "<strong", "名稱", 'class="ask-card__other"', "Other", "<button"];
    const at = order.map((x) => html.indexOf(x));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain(`<button type="button" class="link ask-card__sources" aria-expanded="false">${fill(s.reviewSources, { count: 2 }, language)}</button>`);
  });

  it("關係沒有類型膠囊；沒有出處時不顯示連結", () => {
    const html = item({ sources: { count: 0, open: false, onToggle: () => {} } });
    expect(html).not.toContain("ask-card__kind");
    expect(html).not.toContain("<button");
  });

  it("樣式：surfaceRaised 圓角方塊、膠囊有色點、其他語言名稱 textMuted、出處是 13px 的連結", () => {
    expect(rule("p.ask-card__item")).toMatchObject({ background: "var(--color-surfaceRaised)", "border-radius": "10px", padding: "10px 12px" });
    expect(rule(".ask-card__kind")).toMatchObject({ gap: "6px", background: "var(--color-surface)", border: "1px solid var(--color-border)" });
    expect(rule(".ask-card__kind .type-dot")).toMatchObject({ width: "9px", height: "9px" });
    expect(rule(".ask-card__other")).toMatchObject({ color: "var(--color-textMuted)", "font-size": "13px" });
    expect(rule(".ask-card__item button.ask-card__sources")).toMatchObject({ "font-size": "13px" });
  });

  it("待審頁的接縫卡與上傳者的請上傳者確認都用 SeamItem；接縫卡不用外框按鈕的出處開關", () => {
    expect(requestAsk).toContain("<SeamItem");
    const cards = reviewPage.slice(reviewPage.indexOf("const seamItem ="), reviewPage.indexOf("const autoRow ="));
    expect(cards).toContain("<SeamItem");
    expect(cards).not.toContain("sourcesToggle(");
    expect(cards).not.toContain("typeBadge(");
  });

  it("桌機只在逐筆核准的實體列藏類型名稱；「已直接收錄」的列不留下空膠囊（S-Review ⑥）", () => {
    expect(rule(".review-page--desktop .review-entity .entity-badge__label")).toMatchObject({ position: "absolute" });
    expect(cssText).not.toMatch(/\.review-page--desktop \.entity-badge__label\s*\{/);
  });
});
