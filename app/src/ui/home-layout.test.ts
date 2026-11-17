// 桌機的首頁（#331，畫板 docs/design/v1/boards/K-Home.dc.html）：問候與提問框在上、auto-fit 的兩欄卡片、52px 的提問框與列、狀態點的 token。
// 手機（phone，#356，畫板 K-Mobile 的首頁）：不顯示可見範圍、單行提問框、主管的數字卡在最上、區塊不是卡片。
// 平板（wide=false、phone 省略）維持原本的排法：可見範圍在問候下方、多行輸入框、常見問題在輸入框上方。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings, TRANSLATIONS } from "../client/i18n";
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
      asked: [{ question: "Q1", at: now, refused: false, seen: [] }],
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

  it("平板：可見範圍、多行輸入框與常見問題的位置不變", () => {
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

describe("手機（#356，畫板 K-Mobile 的首頁）", () => {
  const phone = (extra: Record<string, unknown> = {}) => render(false, { phone: true, ...extra });
  const waiting = { documents: 3, conflicts: 2, reports: 1, earliestReport: now, total: 6 };

  it("不顯示可見範圍（在身分與語言面板）；單行輸入框在上、常見問題在下；區塊不是卡片", () => {
    const html = phone();
    expect(html).toContain('class="home home--phone"');
    expect(html).not.toContain("home__scope");
    expect(html).not.toContain("<textarea");
    expect(html).toMatch(/<input id="question-input" type="text"/);
    expect(html.indexOf('class="free-question free-question--compact"')).toBeLessThan(html.indexOf(`aria-label="${s.home.commonQuestions}"`));
    expect(html).not.toContain('class="card home__card');
  });

  it("問過的問題：每則一行（問題與相對時間），整行是「再問一次」", () => {
    const html = phone();
    const today = new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(0, "day");
    expect(html).toMatch(new RegExp(`<button type="button" class="home__row home__row--line home__row--tap" aria-label="${s.home.askAgain}${s.colon}Q1">.*${today}</time></button>`));
    expect(html).not.toContain("home__again");
  });

  it("主管：數字卡（待審文件＋說法不同、回報有錯＋最早時間）與「開始審核」在提問框上方", () => {
    const html = phone({ waiting });
    expect(html).toContain('<div class="home__stat home__stat--conflict"><span class="home__stat-count">3</span>');
    expect(html).toContain(`>${s.home.pendingDocuments}<`);
    expect(html).toContain(`>${s.home.pendingReports}<`);
    expect(html).toContain(s.home.waitingConflicts.replace("{count}", "2"));
    expect(html).toContain(`<time class="home__stat-sub" dateTime="${now}"`);
    expect(html.indexOf('class="home__start"')).toBeLessThan(html.indexOf('class="free-question'));
    // 最近新增的文件接在提問框後面
    expect(html.indexOf("home__documents")).toBeLessThan(html.indexOf("home__asked"));
  });

  it("主管沒有待審時用空狀態的共同元件，沒有數字卡與「開始審核」", () => {
    const html = phone({ waiting: { documents: 0, conflicts: 0, reports: 0, earliestReport: null, total: 0 } });
    expect(html).toContain(s.home.waitingNone);
    expect(html).not.toContain("home__stat");
    expect(html).not.toContain("home__start");
  });

  it("尺寸：問候 22px；提問框與常見問題 44px（觸控目標）；數字卡兩欄、數字 34px；「開始審核」50px", () => {
    expect(rule(".home--phone .home__top h2")).toEqual({ "font-size": "22px", "font-weight": "700" });
    expect(rule(".home--phone .free-question--compact input")).toMatchObject({ height: "44px", border: "none" });
    expect(rule(".home--phone .free-question--compact button")).toMatchObject({ height: "44px" });
    expect(rule(".home--phone .composer--compact .presets button")).toMatchObject({ height: "44px" });
    expect(rule(".home--phone .composer--compact .presets")).toMatchObject({ "overflow-x": "auto", "margin-right": "-1rem", "padding-right": "1rem" });
    expect(rule(".home__stats")).toMatchObject({ "grid-template-columns": "repeat(2, minmax(0, 1fr))" });
    expect(rule(".home__stat-count")).toMatchObject({ "font-family": "var(--font-display)", "font-size": "34px" });
    expect(rule(".home__stat--conflict")).toMatchObject({ border: "1.5px solid var(--color-conflict)" });
    expect(rule(".home__start")).toMatchObject({ height: "50px" });
  });

  it("提問框和其他區塊同寬：不沿用問答頁的整寬、sticky 輸入列（左右 -1rem）", () => {
    expect(rule(".app--phone .composer")).toMatchObject({ position: "sticky", margin: "0 -1rem" });
    expect(rule(".home--phone .composer--compact")).toMatchObject({ position: "static", margin: "0" });
  });

  it("列：有更新至少 60px、surface 底；問過的問題與文件是下方 1px 的線、至少 44px", () => {
    expect(rule(".home--phone .home__row--raised")).toMatchObject({ "min-height": "60px", background: "var(--color-surface)" });
    expect(rule(".home--phone .home__row--line")).toMatchObject({ "min-height": "44px", border: "none", "border-bottom": "1px solid var(--color-border)" });
  });
});

// 「以前答不出來，現在可能答得出來了」（#408）：A1（問過的問題中那一題）與 A2（問候下方一句話＋三點時間線）
describe("可能答得出來了（#408）", () => {
  const earlier = "2026-11-10T09:00:00.000Z";
  const later = "2026-11-12T09:00:00.000Z";
  const asked = [
    { question: "Q-new", at: later, refused: true, seen: [] },
    { question: "Q-old", at: earlier, refused: true, seen: [] },
    { question: "Q-plain", at: earlier, refused: false, seen: [] },
  ];
  const maybeAnswerable = [
    { question: "Q-old", at: earlier, document: { id: "d1", title: "Doc-Old" }, retrieved: ["p1"] },
    { question: "Q-new", at: later, document: { id: "d2", title: "Doc-New" }, retrieved: ["p2"] },
  ];
  const withMaybe = (wide: boolean, extra: Record<string, unknown> = {}) => render(wide, { asked, maybeAnswerable, onAcknowledge: () => {}, ...extra });
  const count = (html: string, text: string) => html.split(text).length - 1;

  for (const [name, html] of [
    ["桌機", () => withMaybe(true)],
    ["手機", () => withMaybe(false, { phone: true })],
  ] as const) {
    it(`${name}：不在頂端的題目是 A1 的列，有「那時候」「現在」兩行、可點的文件標題、「再問一次」與「知道了」；其他題照舊`, () => {
      const out = html();
      expect(count(out, 'class="home__row home__row--maybe"')).toBe(1);
      expect(out).toMatch(/class="home__row home__row--maybe"><span class="home__question" title="Q-old">/);
      expect(out).toContain('<button type="button" class="link home__doc-link" title="Doc-Old">Doc-Old</button>');
      expect(out).toContain(`aria-label="${s.home.acknowledge}${s.colon}Q-old"`);
      expect(out).toContain(`aria-label="${s.home.askAgain}${s.colon}Q-plain"`);
      expect(out).not.toContain(`aria-label="${s.home.acknowledge}${s.colon}Q-plain"`);
    });

    it(`${name}：與頂端同一題在問過的問題中是一般的列，只多小標示；不展開兩行、沒有「知道了」（#413）`, () => {
      const out = html();
      const list = out.slice(out.indexOf('aria-labelledby="home-asked"'));
      const row = list.slice(list.lastIndexOf("<li", list.indexOf('title="Q-new"')), list.indexOf("</li>", list.indexOf('title="Q-new"')));
      expect(row).toContain("home__row--line");
      expect(row).not.toContain("home__row--maybe");
      expect(count(row, `<span class="home__maybe-badge">${s.home.maybeBadge}</span>`)).toBe(1);
      expect(row).toContain(`aria-label="${s.home.askAgain}${s.colon}Q-new"`);
      expect(row).not.toContain(s.home.maybeThen.split("{")[0]);
      expect(row).not.toContain(s.home.acknowledge);
      expect(count(out, "home__maybe-badge")).toBe(1);
    });

    it(`${name}：A2 在問候下方、提問框上方，只顯示最近的一題，附三點時間線`, () => {
      const out = html();
      const recall = out.indexOf(`aria-label="${s.home.recallTitle}"`);
      expect(recall).toBeGreaterThan(out.indexOf("</h2>"));
      expect(recall).toBeLessThan(out.indexOf("free-question"));
      expect(count(out, `aria-label="${s.home.recallTitle}"`)).toBe(1);
      const section = out.slice(recall, out.indexOf("</section>", recall));
      expect(section).toContain("Q-new");
      expect(section).not.toContain("Q-old");
      expect(section.match(/<ol class="home__timeline"[^>]*>(.*?)<\/ol>/)?.[1].match(/<li>/g)).toHaveLength(3);
      expect(section).toContain(`aria-label="${s.home.acknowledge}${s.colon}Q-new"`);
    });
  }

  it("只有一題可能答得出來時：頂端是那一題，下方是小標示，沒有 A1 的列（#413）", () => {
    const out = withMaybe(true, { maybeAnswerable: maybeAnswerable.slice(0, 1) });
    expect(count(out, `aria-label="${s.home.recallTitle}"`)).toBe(1);
    expect(out).not.toContain("home__row--maybe");
    expect(count(out, "home__maybe-badge")).toBe(1);
    expect(count(out, `aria-label="${s.home.acknowledge}${s.colon}Q-old"`)).toBe(1);
  });

  it("按頂端的「知道了」後：頂端與小標示一起換成下一題，下一題在下方改成小標示（#413）", () => {
    // 「知道了」由 App 把那一題從 maybeAnswerable 移除；畫面只依剩下的資料
    const after = withMaybe(true, { maybeAnswerable: maybeAnswerable.filter((m) => m.question !== "Q-new") });
    const recall = after.slice(after.indexOf(`aria-label="${s.home.recallTitle}"`), after.indexOf("</section>", after.indexOf(`aria-label="${s.home.recallTitle}"`)));
    expect(recall).toContain("Q-old");
    expect(recall).not.toContain("Q-new");
    expect(after).not.toContain("home__row--maybe");
    expect(count(after, "home__maybe-badge")).toBe(1);
    expect(after).not.toContain(`aria-label="${s.home.acknowledge}${s.colon}Q-new"`);
    expect(after).toContain(`aria-label="${s.home.askAgain}${s.colon}Q-new"`);
    // 最後一題也「知道了」：頂端與小標示都消失
    const none = withMaybe(true, { maybeAnswerable: [] });
    expect(none).not.toContain("home__recall");
    expect(none).not.toContain("home__maybe-badge");
  });

  it("沒有可能答得出來的題目、或沒有「知道了」時不顯示 A1 與 A2", () => {
    for (const out of [render(true, { asked }), render(true, { asked, maybeAnswerable })]) {
      expect(out).not.toContain("home__row--maybe");
      expect(out).not.toContain("home__recall");
      expect(out).not.toContain("home__maybe-badge");
    }
  });

  it("醒目但不是成功：primary 細框，不用 success 或勾勾", () => {
    expect(rule(".home__row--maybe")).toMatchObject({ border: "1px solid var(--color-primary)" });
    expect(rule(".home__recall")).toMatchObject({ border: "1px solid var(--color-primary)" });
    const blocks = cssText.match(/\.home__(?:row--maybe|maybe-|recall|timeline|dismiss)[^{]*\{[^}]*\}/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.join("\n")).not.toContain("success");
    expect(withMaybe(true)).not.toMatch(/[✓✔]/);
  });

  it("手機：動作的觸控目標 44px", () => {
    expect(rule(".home--phone :is(.home__maybe-actions, .home__recall-actions) button")).toMatchObject({ height: "44px" });
  });

  // 措辭：只是檢索找到資料、還沒有回答，所以說「可能」；回顧的口吻，不用數字、分數或評量
  it.each(Object.keys(TRANSLATIONS))("措辭（%s）：不說已經答得出來，不用數字、分數或評量", (lang) => {
    const h = strings(lang).home;
    for (const t of [h.recallTitle, h.recallText, h.recallTimeline, h.recallAsked, h.recallToday, h.maybeThen, h.maybeNow, h.acknowledge, h.maybeBadge])
      expect(t, t).not.toMatch(/已經|already|\d|%|分數|score|學到|learn/i);
  });
});
