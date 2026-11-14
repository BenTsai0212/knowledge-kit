// 桌機的圖譜（#336，畫板 docs/design/v1/boards/Graph.dc.html、G-Scale.dc.html）：實體面板的列與卡片、找路徑的面板、頁首的搜尋框，
// 以及畫布、工具列、實體欄的尺寸與 token。手機、平板與展示模式（wide、panel、field 都沒有傳）維持原本的 markup。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import type { Graph, SourcePassage } from "../graph/read";
import css from "./app.css?raw";
import { EntityPanel } from "./EntityPanel";
import { EntitySearch } from "./EntitySearch";
import graphPage from "./GraphPage.tsx?raw";
import { PathPanel } from "./PathPanel";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

// CSS 規則的宣告（選擇器完全相同、不在 @media 中的第一條）
function rule(selector: string): Record<string, string> {
  const block = cssText.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]()"=:>+]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1];
  expect(block, selector).toBeDefined();
  return Object.fromEntries([...`${block};`.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const language = clientConfig.client.defaultLanguage;
const s = strings(language);
const [typeA, typeB] = clientConfig.knowledgeModel.entityTypes;
const relationType = clientConfig.knowledgeModel.relationTypes[0];
const passage: SourcePassage = { id: "p1", documentId: "d1", documentTitle: "文件甲", language, content: "甲在這裡" };
const graph: Graph = {
  entities: [
    { id: "a", type: typeA.id, name: "甲", names: {}, sources: [passage] },
    { id: "b", type: typeB.id, name: "乙", names: {}, sources: [] },
  ],
  relations: [{ id: "r1", type: relationType.id, from: "a", to: "b", sources: [passage] }],
};
const noop = () => {};

const panel = (wide: boolean) =>
  renderToStaticMarkup(
    createElement(EntityPanel, {
      graph,
      entityId: "a",
      language,
      onSelect: noop,
      onShowOnly: noop,
      onAskAbout: noop,
      onOpenSource: noop,
      retractions: [],
      onRetract: async () => null,
      wide,
    }),
  );

describe("實體面板", () => {
  it("桌機：不是卡片；相關實體是列（類型的形狀＋名稱按鈕＋右側關係名稱），出現的文件是卡片、名稱用 mark", () => {
    const html = panel(true);
    expect(html).toContain('class="entity entity--wide"');
    expect(html).not.toContain("card entity");
    expect(html).toMatch(/<li class="entity-row"><span class="type-dot shape-\w+" aria-hidden="true"[^>]*><\/span><button type="button" class="link">乙<\/button><span class="entity-row__relation muted">[^<]+ →<\/span><\/li>/);
    expect(html).toContain('class="entity-documents entity-documents--cards"');
    expect(html).toContain("<mark>甲</mark>");
  });

  it("手機、平板與展示模式：卡片、項目符號的關係清單與原本的文件清單", () => {
    const html = panel(false);
    expect(html).toContain('class="card entity"');
    expect(html).not.toContain("entity-row");
    expect(html).toContain('class="entity-documents"');
  });

  it("樣式：寬 340px、左邊 border、surface 底的整高欄；名稱 28px／700；列 52px、1px border；卡片 surfaceRaised", () => {
    expect(rule(".graph-entity-column")).toMatchObject({
      flex: "0 0 340px",
      "overflow-y": "auto",
      "border-left": "1px solid var(--color-border)",
      background: "var(--color-surface)",
    });
    expect(rule(".entity--wide h2")).toMatchObject({ "font-size": "28px", "font-weight": "700" });
    expect(rule(".entity-row")).toMatchObject({ "min-height": "52px", border: "1px solid var(--color-border)", "border-radius": "var(--radius-medium)" });
    expect(rule(".entity-row button.link::after")).toMatchObject({ position: "absolute", inset: "0" });
    expect(rule(".entity--wide .entity-actions button")).toMatchObject({ height: "44px" });
    expect(rule(".entity-documents--cards .entity-document")).toMatchObject({ background: "var(--color-surfaceRaised)" });
    expect(rule(".entity-documents--cards .entity-excerpt mark")).toMatchObject({ "background-color": "var(--color-mark)", color: "var(--color-markText)" });
  });
});

describe("頁首與找路徑", () => {
  it("桌機的搜尋框：標籤只給報讀器，有搜尋 icon，placeholder 是標籤；44px、最少 240px", () => {
    const html = renderToStaticMarkup(createElement(EntitySearch, { graph, language, label: s.graphSearch, onPick: noop, field: true }));
    expect(html).toMatch(new RegExp(`<label for="[^"]+" class="visually-hidden">${s.graphSearch}</label><svg class="entity-search__icon"`));
    expect(html).toContain(`placeholder="${s.graphSearch}"`);
    expect(rule('.entity-search--field input[type="search"]')).toMatchObject({ height: "44px", "border-radius": "12px" });
    expect(rule(".graph-head .entity-search")).toMatchObject({ "min-width": "240px" });
    expect(rule(".graph-head h2")).toMatchObject({ "font-size": "28px", "font-weight": "700" });
    expect(rule("button.secondary.graph-path-button")).toMatchObject({ height: "44px" });
    // 手機、平板與展示模式：標籤在上方
    const plain = renderToStaticMarkup(createElement(EntitySearch, { graph, language, label: s.graphSearch, onPick: noop }));
    expect(plain).not.toContain("visually-hidden");
    expect(plain).not.toContain("placeholder");
  });

  it("「找路徑」打開的面板有標題，內容與可收合區塊相同；手機、平板與展示模式仍是可收合區塊", () => {
    const props = { graph, language, from: "a", to: null, path: null, onChange: noop, onOpenSource: noop };
    const opened = renderToStaticMarkup(createElement(PathPanel, { ...props, panel: { id: "path" } }));
    expect(opened).toMatch(/^<section id="path" class="card path path--panel" aria-labelledby="path-title"><h2 id="path-title">/);
    expect(opened).not.toContain("<details");
    const details = renderToStaticMarkup(createElement(PathPanel, props));
    expect(details).toMatch(/^<details class="card path"><summary>/);
    // 內容（兩端的搜尋框與說明）相同
    expect(opened.slice(opened.indexOf('<div class="path-select">'), -"</section>".length)).toBe(details.slice(details.indexOf('<div class="path-select">'), -"</details>".length));
    expect(graphPage).toContain("aria-expanded={pathOpen}");
    expect(graphPage).toContain("aria-controls={pathId}");
  });
});

describe("畫布與工具列", () => {
  it("畫布：surface、1px border、圓角 20px、24px 點狀底紋，填滿剩下的高度；縮放按鈕 44px、有 aria-label", () => {
    expect(rule(".graph-stage")).toMatchObject({
      flex: "1 1 auto",
      border: "1px solid var(--color-border)",
      "border-radius": "20px",
      "background-color": "var(--color-surface)",
      "background-size": "24px 24px",
    });
    expect(cssText).toMatch(/@media \(min-height: 900px\) \{\s*\.graph-stage \{\s*min-height: 722px;/);
    // 左欄與實體欄撐滿頁面的高度（一般的 .graph-page 是 start 對齊），畫布才填滿到視窗底部
    expect(rule(".graph-page.graph-page--desktop")).toMatchObject({ "align-items": "stretch" });
    expect(rule(".graph-page--desktop .graph-frame")).toMatchObject({ "grid-template-columns": "minmax(0, 1fr)", "grid-template-rows": "minmax(0, 1fr)" });
    expect(rule(".graph-zoom-buttons button")).toMatchObject({ width: "44px", height: "44px" });
    expect(graphPage).toContain("aria-label={s.graphZoomIn}");
    expect(graphPage).toContain("aria-label={s.graphZoomOut}");
    // 頁面不留邊：實體欄貼齊右緣
    expect(rule("main.page:has(> .graph-page--desktop)")).toMatchObject({ padding: "0" });
  });

  it("工具列的類型膠囊、「只顯示關聯 ≥ N」與「清單模式」是 32px 的膠囊；按鍵提示列在畫布外框有鍵盤焦點時出現", () => {
    expect(rule(".graph-chip,\n.legend .graph-chip")).toMatchObject({ height: "32px", "border-radius": "var(--radius-pill)" });
    expect(rule(".type-check")).toMatchObject({ appearance: "none", border: "2px solid var(--type-color)" });
    expect(rule(".type-check:checked")).toMatchObject({ background: "var(--type-color)" });
    expect(rule(".graph-stage:has(> .graph-frame:focus-visible) + .graph-keys")).toEqual({ display: "flex" });
  });

  it("手機（#357）：畫布左右滿版：頁面的 flex column 撐滿寬度、外層 main 與畫布容器沒有左右 padding，16px 只留給上方的搜尋列與分段切換", () => {
    expect(rule(".graph-page.graph-page--phone")).toMatchObject({ display: "flex", "flex-direction": "column", "align-items": "stretch" });
    expect(rule(".app.app--phone:has(.graph-page--phone) > main")).toMatchObject({ padding: "0" });
    expect(rule(".graph-page--phone .graph-main")).not.toHaveProperty("padding");
    expect(rule(".graph-phone-stage")).not.toHaveProperty("padding");
    expect(rule(".graph-page--phone .graph-tools")).toMatchObject({ padding: "16px 16px 8px" });
  });

  it("展示模式維持原本的版面", () => {
    expect(graphPage).toContain('const desktop = layout === "desktop" && !presentationMode;');
  });
});
