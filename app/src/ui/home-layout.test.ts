// 桌機的首頁（#331，畫板 docs/design/v1/boards/K-Home.dc.html）：問候與提問框在上、auto-fit 的兩欄卡片、52px 的提問框與列、狀態點的 token。
// 手機與平板（wide=false）維持原本的排法：可見範圍在問候下方、多行輸入框、常見問題在輸入框上方。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import css from "./app.css?raw";
import { HomePage } from "./HomePage";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

// CSS 規則的宣告（選擇器完全相同、不在 @media 中的那一條）
function rule(selector: string): Record<string, string> {
  const block = cssText.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]()"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1];
  expect(block, selector).toBeDefined();
  return Object.fromEntries([...`${block};`.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const language = clientConfig.client.defaultLanguage;
const s = strings(language);
// 有常見問題的身分
const role = clientConfig.scenarios.scenarios[0].role;
const now = new Date().toISOString();

const render = (wide: boolean, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(HomePage, {
      db: null,
      language,
      identity: role,
      wide,
      asked: [{ question: "Q1", at: now }],
      askDisabled: false,
      limit: null,
      draft: "",
      onDraft: () => {},
      onAsk: () => {},
      onStartReview: () => {},
      viewed: [],
      onOpenDocument: () => {},
      onOpenEntity: () => {},
      ...extra,
    }),
  );

describe("桌機與手機、平板的排法", () => {
  it("桌機：不顯示可見範圍（在左側欄的使用者卡）；單行輸入框在上、常見問題在下，沒有「每題獨立回答」", () => {
    const html = render(true);
    expect(html).toContain('class="home home--wide"');
    expect(html).not.toContain("home__scope");
    expect(html).toMatch(/<input id="question-input" type="text"[^>]*aria-label="[^"]+"/);
    expect(html).not.toContain("<textarea");
    expect(html.indexOf('class="free-question free-question--compact"')).toBeLessThan(html.indexOf(`aria-label="${s.home.commonQuestions}"`));
    expect(html).not.toContain("qa-independent");
  });

  it("手機與平板：可見範圍、多行輸入框與常見問題的位置不變", () => {
    const html = render(false);
    expect(html).toContain('class="home"');
    expect(html).toContain("home__scope");
    expect(html).toContain("<textarea");
    expect(html.indexOf(`aria-label="${s.home.commonQuestions}"`)).toBeLessThan(html.indexOf('class="free-question"'));
  });

  it("問過的問題：問題、相對的提問時間與「再問一次」；說明在清單下方", () => {
    const html = render(true);
    const today = new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(0, "day");
    expect(html).toMatch(new RegExp(`<time class="home__when" dateTime="${now.replace(/\./g, "\\.")}"[^>]*>${today}</time>`));
    expect(html).toContain(`aria-label="${s.home.askAgain}${s.colon}Q1"`);
    expect(html.indexOf("home__note")).toBeGreaterThan(html.indexOf("home__when"));
  });

  it("空的時候用空狀態的共同元件", () => {
    expect(render(true, { asked: [] })).toContain(`<div class="empty-state">`);
  });
});

describe("尺寸與 token（畫板 K-Home）", () => {
  it("問候 28px／700；卡片 auto-fit（最小 340px）、間距 20px、padding 20px、標題 17px", () => {
    expect(rule(".home--wide .home__top h2")).toEqual({ "font-size": "28px", "font-weight": "700" });
    expect(rule(".home--wide .home__cards")).toMatchObject({ "grid-template-columns": "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: "20px" });
    expect(rule(".home--wide .home__card")).toEqual({ padding: "20px" });
    expect(rule(".home--wide .home__card h3")).toEqual({ "font-size": "17px", "font-weight": "700" });
  });

  it("寬螢幕最多兩欄：最寬放得下兩欄（340px × 2＋20px），放不下三欄", () => {
    const max = parseInt(rule(".home--wide")["max-width"], 10);
    expect(max).toBeGreaterThanOrEqual(340 * 2 + 20);
    expect(max).toBeLessThan(340 * 3 + 20 * 2);
  });

  it("提問框：輸入框與「提問」都是 52px；常見問題是 36px 的中性按鈕", () => {
    expect(rule(".free-question--compact input")).toMatchObject({ height: "52px", "background-color": "var(--color-background)" });
    expect(rule(".free-question--compact button")).toMatchObject({ height: "52px" });
    expect(rule(".composer--compact .presets button")).toMatchObject({
      height: "36px",
      border: "1px solid var(--color-border)",
      "border-radius": "var(--radius-pill)",
      background: "transparent",
    });
  });

  it("列至少 52px；有更新／等你處理是 surfaceRaised 底，其他是 border 框；時間是 mono 12px", () => {
    expect(rule(".home__row")).toMatchObject({ "min-height": "52px", "border-radius": "12px" });
    expect(rule(".home__row--raised")).toEqual({ background: "var(--color-surfaceRaised)" });
    expect(rule(".home__row--line")).toEqual({ border: "1px solid var(--color-border)" });
    expect(rule(".home__when")).toMatchObject({ "font-family": "var(--font-mono)", "font-size": "12px" });
  });

  it("狀態點 8px，顏色用狀態 token", () => {
    expect(rule(".home__dot")).toMatchObject({ width: "8px", height: "8px" });
    for (const dot of ["success", "primary", "conflict", "warning", "danger"]) expect(rule(`.home__dot--${dot}`)).toEqual({ background: `var(--color-${dot})` });
  });

  it("最近看過：40px 的圓角按鈕，形狀用實體類型色", () => {
    expect(rule(".home__chip")).toMatchObject({ height: "40px", "border-radius": "var(--radius-pill)" });
    expect(rule(".home__shape")).toMatchObject({ width: "10px", height: "10px", background: "var(--type-color)" });
  });
});
