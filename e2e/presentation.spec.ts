// 客戶展示模式（#129，docs/qa.md「展示模式」）：?mode=presentation 只顯示問答與圖譜兩個頁籤，能審查的身分也一樣。/api/ask 一律是假的回應。
import { expect, test, type Page } from "@playwright/test";
import { identityBadge, identitySegments, identitySheet, language, openApp, openTab, presetQuestions, s, sourcePanel, switchIdentity } from "./support/app";
import { access, client, scenarios, theme } from "./support/client";
import { FAKE_ANSWER_LEAD } from "./support/fake-ask";
import { waitForGraphIdle } from "./support/graph";

test.beforeEach(async ({ page }) => {
  await openApp(page, "/?mode=presentation");
});

test("每個身分都只有問答與圖譜兩個頁籤", async ({ page }) => {
  const tabs = page.getByRole("navigation", { name: s.views }).getByRole("button");
  for (const role of access.roles) {
    await switchIdentity(page, role.id);
    await expect(tabs).toHaveText([s.tabQa, s.tabGraph]);
  }
});

test("與 tools=evals 併用：仍只有問答與圖譜", async ({ page }) => {
  // beforeEach 已輸入邀請碼（存在 sessionStorage），重新載入時不再要求輸入
  await page.goto("/?mode=presentation&tools=evals");
  await expect(page.getByRole("button", { name: presetQuestions[0].text, exact: true })).toBeEnabled();
  const tabs = page.getByRole("navigation", { name: s.views }).getByRole("button");
  for (const role of access.roles.filter((r) => r.canReview)) {
    await switchIdentity(page, role.id);
    await expect(tabs).toHaveText([s.tabQa, s.tabGraph]);
  }
});

test("問答：回答附出處，點出處打開原文；圖譜：畫出畫布", async ({ page }) => {
  const question = presetQuestions[0];
  await switchIdentity(page, question.role);
  await page.getByRole("button", { name: question.text, exact: true }).click();
  const answer = page.locator("section.answer");
  await expect(answer).toContainText(FAKE_ANSWER_LEAD);
  await answer.getByRole("button", { name: "1", exact: true }).click();
  await expect(sourcePanel(page)).toBeVisible();

  await openTab(page, s.tabGraph);
  await expect(page.locator(".graph-canvas canvas").first()).toBeVisible();
  // 原文仍開著時也是浮動的卡片，不擠掉圖譜的畫布（#349）
  await expect(sourcePanel(page)).toHaveCSS("position", "absolute");
});

// 以第一個預設問題的身分問一題，等回答出現
async function askFirst(page: Page) {
  const question = presetQuestions[0];
  await switchIdentity(page, question.role);
  await page.getByRole("button", { name: question.text, exact: true }).click();
  const answer = page.locator("section.answer");
  await expect(answer).toContainText(FAKE_ANSWER_LEAD);
  return answer;
}

// 字級與主題、隱藏與保留（#260，docs/design.md「展示模式」）
test("字級放大（--present-*），原文是浮在右側的卡片、寬 620px", async ({ page }) => {
  await expect(page.locator("html")).toHaveAttribute("data-mode", "presentation");
  await expect(page.locator("body")).toHaveCSS("font-size", "20px");
  const answer = await askFirst(page);
  await expect(answer.locator("h2")).toHaveCSS("font-size", "36px");
  await expect(answer.locator("h2")).toHaveCSS("font-weight", "700");
  await expect(answer.locator(".answer-text")).toHaveCSS("font-size", "28px");
  const citation = answer.getByRole("button", { name: "1", exact: true });
  await expect(citation).toHaveCSS("height", "36px");
  await expect(page.getByRole("banner").getByText(s.fictionalData, { exact: true })).toHaveCSS("font-size", "16px");

  await citation.click();
  const panel = sourcePanel(page);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("position", "absolute");
  await expect(panel).toHaveCSS("width", "620px");
  await expect(panel.locator(".source-text")).toHaveCSS("font-size", "22px");
});

test("預設 Light：系統是深色時也不跟隨", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "light");
});

test("隱藏「回報有錯」「這次的問題」「更換邀請碼」；保留標示、身分與語言", async ({ page }) => {
  const answer = await askFirst(page);
  await expect(answer.getByRole("button", { name: s.reportButton })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: s.sessionQuestions })).toHaveCount(0);
  await expect(page.getByRole("button", { name: s.changeAccessCode })).toHaveCount(0);
  const banner = page.getByRole("banner");
  await expect(banner.getByText(s.fictionalData, { exact: true })).toBeVisible();
  await expect(banner.getByText(s.demoPermissions, { exact: true })).toBeVisible();
  await expect(banner.getByLabel(s.identity)).toBeVisible();
  await expect(banner.getByLabel(s.language)).toBeVisible();
});

test("一般模式（不帶參數）：字級與隱藏的元素不變", async ({ page }) => {
  // beforeEach 已輸入邀請碼（存在 sessionStorage），重新載入時不再要求輸入
  await page.goto("/");
  await openTab(page, s.tabQa);
  expect(await page.locator("html").getAttribute("data-mode")).toBeNull();
  await expect(page.locator("body")).toHaveCSS("font-size", "16px");
  const answer = await askFirst(page);
  // 桌機的問題泡泡 16px、回答本文 17px（#335，畫板 QA）
  await expect(answer.locator("h2")).toHaveCSS("font-size", "16px");
  await expect(answer.locator(".answer-text")).toHaveCSS("font-size", "17px");
  await expect(answer.getByRole("button", { name: s.reportButton })).toBeVisible();
  // 桌機的「更換邀請碼」在使用者卡的選單裡（#330）
  await identityBadge(page).click();
  await expect(identitySheet(page).getByRole("button", { name: s.changeAccessCode })).toBeVisible();
});

// 頂端列與劇本（#260 PR 2，docs/design.md「展示模式」的「版面」）
test("頂端列：客戶名稱、標示、「問答｜圖譜」、身分分段切換（快捷鍵數字、56px 高）與語言；沒有左導覽與輸入區的預設問題", async ({ page }) => {
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("heading", { level: 1 })).toHaveText(client.displayName[language]);
  await expect(banner.getByText(s.fictionalData, { exact: true })).toBeVisible();
  await expect(banner.getByText(s.demoPermissions, { exact: true })).toBeVisible();
  const tabs = banner.getByRole("navigation", { name: s.views }).getByRole("button");
  await expect(tabs).toHaveText([s.tabQa, s.tabGraph]);
  await expect(tabs.first()).toHaveCSS("min-height", "56px");
  const segments = identitySegments(page);
  for (const [index, role] of access.roles.entries()) {
    await expect(segments.getByRole("radio", { name: role.label[language], exact: true })).toHaveCount(1);
    const segment = segments.locator("label").nth(index);
    await expect(segment.locator("kbd")).toHaveText(String(index + 1));
    await expect(segment).toHaveCSS("min-height", "56px");
  }
  await expect(segments.getByRole("radio", { name: access.roles[0].label[language], exact: true })).toBeChecked();
  await expect(banner.getByLabel(s.language)).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.getByRole("group", { name: s.presetQuestions })).toHaveCount(0);
});

test("劇本：依情境分組；點另一個身分情境的題目時先切到該身分再送出，標 ✓ 與「第 N／M 題」", async ({ page }) => {
  const script = page.getByRole("navigation", { name: s.presentation.script });
  // 「劇本」標題（h2）下，每個情境一組（h3，#349）
  await expect(script.getByRole("heading", { level: 2 })).toHaveText(s.presentation.script);
  await expect(script.getByRole("heading", { level: 3 })).toHaveCount(scenarios.scenarios.length);
  for (const scenario of scenarios.scenarios) {
    await expect(script.getByRole("heading", { level: 3, name: scenario.title[language] })).toBeVisible();
  }
  const current = access.roles[0].id;
  const index = presetQuestions.findIndex((q) => q.role !== current);
  test.skip(index === -1, "scenarios.json 的情境都是第一個身分，沒有需要切換身分的題目");
  const target = presetQuestions[index];
  const role = access.roles.find((r) => r.id === target.role)!;

  const button = script.getByRole("button", { name: target.text, exact: true });
  await expect(button).toHaveCSS("min-height", "56px");
  await button.click();
  await expect(identitySegments(page).getByRole("radio", { name: role.label[language], exact: true })).toBeChecked();
  await expect(page.locator(".identity-segments__name.is-bump")).toHaveText(role.label[language]);
  const answer = page.locator("section.answer");
  await expect(answer.locator("h2")).toHaveText(target.text);
  await expect(answer).toContainText(FAKE_ANSWER_LEAD);

  await expect(button).toHaveAttribute("aria-current", "step");
  await expect(button).toContainText("✓");
  await expect(button).toHaveAccessibleDescription(s.presentation.scriptAsked);
  const progress = s.presentation.scriptProgress.replace("{index}", String(index + 1)).replace("{total}", String(presetQuestions.length));
  await expect(script.getByText(progress, { exact: true })).toBeVisible();

  // 切回原本的身分：✓ 仍在（依各身分的對話判斷，#303）
  await switchIdentity(page, current);
  await expect(button).toContainText("✓");
});

// 圖譜（#260 PR 3，docs/design.md「展示模式」的「圖譜」）：節點標籤 18px、選取 26px，其他節點 28%，選取的關係加粗並標名稱；實體卡片放大
test("圖譜：標籤放大、選取實體以外的節點 28%、實體卡片放大", async ({ page }) => {
  await openTab(page, s.tabGraph);
  const canvas = ".graph-page .graph-canvas";
  await waitForGraphIdle(page, canvas);
  const start = page.getByRole("region", { name: s.graphTopConnected });
  await start.getByRole("listitem").first().getByRole("button").click();

  // cytoscape 的樣式（transition 結束後）。字級是 model 單位，畫面上的大小 = 字級 × zoom：
  // 選取的節點 26px、其他節點 18px 且 28% 不透明、選取的關係標上名稱
  const styles = () =>
    page.evaluate((selector) => {
      type Element = { id(): string; hasClass(c: string): boolean; style(p: string): string };
      type Cy = { zoom(): number; nodes(): Element[] & { filter(f: (n: Element) => boolean): Element[] }; edges(): { filter(f: (e: Element) => boolean): Element[] } };
      const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)?._cyreg?.cy;
      if (cy === undefined) return null;
      const rendered = (n: Element) => Math.round(parseFloat(n.style("font-size")) * cy.zoom());
      const selected = cy.nodes().filter((n) => n.hasClass("selected"));
      const others = cy.nodes().filter((n) => !n.hasClass("selected") && !n.hasClass("hover"));
      const near = cy.edges().filter((e) => e.hasClass("near"));
      return {
        selected: selected.map((n) => [rendered(n), n.style("opacity")]),
        others: [...new Set(others.map((n) => `${rendered(n)} ${n.style("opacity")}`))],
        nearLabelled: near.length > 0 && near.every((e) => e.style("label") !== ""),
        // 關係名稱與一般模式相同（#260 PR 3 第 2 次審查）：與節點標籤相同的 surface 襯底；外框在畫面上 ≤ 3px，
        // 有外框時是背景色（與節點標籤的外框相同），不是 cytoscape 預設的黑色
        nearLabelPlain: near.every((e) => {
          const node = selected[0];
          const outline = parseFloat(e.style("text-outline-width")) * cy.zoom();
          return (
            node !== undefined &&
            e.style("text-background-color") === node.style("text-background-color") &&
            e.style("text-background-opacity") === "1" &&
            outline <= 3 &&
            (outline === 0 || e.style("text-outline-color") === node.style("text-outline-color"))
          );
        }),
      };
    }, canvas);
  await expect.poll(styles).toEqual({ selected: [[26, "1"]], others: ["18 0.28"], nearLabelled: true, nearLabelPlain: true });

  // 畫面上（#260 PR 3 審查）：聚焦集合（選取的實體與相連的實體）的節點連同標籤彼此不重疊、都在畫布內，
  // 選取節點的標籤在畫面上約 26px（不因畫面放大而變得更大）
  await waitForGraphIdle(page, canvas);
  const layout = await page.evaluate((selector) => {
    type Box = { x1: number; y1: number; x2: number; y2: number };
    type Node = { id(): string; hasClass(c: string): boolean; style(p: string): string; renderedBoundingBox(o: { includeLabels: boolean }): Box };
    type Cy = { zoom(): number; width(): number; height(): number; nodes(): Node[] };
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)?._cyreg?.cy;
    if (cy === undefined) return null;
    const focus = cy.nodes().filter((n) => !n.hasClass("dimmed"));
    const boxes = focus.map((n) => ({ id: n.id(), ...n.renderedBoundingBox({ includeLabels: true }) }));
    const overlapping = boxes.flatMap((a, i) =>
      boxes.slice(i + 1).flatMap((b) => (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2 ? [`${a.id} × ${b.id}`] : [])),
    );
    const outside = boxes.filter((b) => b.x1 < 0 || b.y1 < 0 || b.x2 > cy.width() || b.y2 > cy.height()).map((b) => b.id);
    const selected = focus.find((n) => n.hasClass("selected"));
    return { count: focus.length, overlapping, outside, selectedFont: selected === undefined ? 0 : parseFloat(selected.style("font-size")) * cy.zoom() };
  }, canvas);
  expect(layout).not.toBeNull();
  expect(layout!.count).toBeGreaterThan(1);
  expect(layout!.overlapping).toEqual([]);
  expect(layout!.outside).toEqual([]);
  expect(layout!.selectedFont).toBeGreaterThanOrEqual(24);
  expect(layout!.selectedFont).toBeLessThanOrEqual(32);

  // 右側的浮動卡片（#349，畫板 H-Graph）
  const panel = page.locator(".graph-stage-card section.entity");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveCSS("font-size", "44px");
  const ask = panel.getByRole("button", { name: s.graphAskAbout });
  await expect(ask).toHaveCSS("min-height", "64px");
  expect((await ask.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  // 按鈕與「相關實體」標題之間留間距（#260 PR 3 審查）
  const related = panel.getByRole("heading", { level: 3, name: s.relatedEntities });
  expect((await related.boundingBox())!.y - ((await ask.boundingBox())!.y + (await ask.boundingBox())!.height)).toBeGreaterThanOrEqual(12);
});

// 1920×1080（#349，畫板 docs/design/v1/boards/H-QA.dc.html、H-Graph.dc.html）：問題泡泡是 text 底、劇本有編號、原文是浮動卡片
// （Esc 關閉、焦點回到引用標號）、圖譜沒有搜尋框與找路徑、右側卡片的關聯是列、沒有橫向捲動。截圖附在報告（presentation-*-1920.png）
test.describe("1920×1080", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  // 離右緣的距離（不含捲軸）
  const rightGap = async (page: Page, box: { x: number; width: number }) =>
    Math.round((await page.evaluate(() => document.documentElement.clientWidth)) - (box.x + box.width));

  test("問答：頂端列、劇本的編號、問題泡泡、回答卡片、浮動的原文卡片", async ({ page }, testInfo) => {
    // 頂端列：標示是一行小字（不是膠囊）、選中的身分是 text 底
    const labels = page.locator(".presentation-bar__labels");
    await expect(labels).toHaveText(new RegExp(`${s.fictionalData}\\s*·\\s*${s.demoPermissions}`));
    await expect(labels.locator(".badge")).toHaveCount(0);
    await expect(identitySegments(page).locator("label.is-checked")).toHaveCSS("background-color", rgb(theme.colors.text));

    // 劇本：題目列前面是編號（01、02…）
    const script = page.getByRole("navigation", { name: s.presentation.script });
    await expect(script.locator(".script__mark").first()).toHaveText("01");

    const answer = await askFirst(page);
    // 目前的題目即使問過也顯示編號（✓ 只標目前以外問過的題目）
    await expect(script.locator('button[aria-current="step"] .script__mark')).toHaveText("01");
    const question = answer.locator("h2");
    await expect(question).toHaveCSS("background-color", rgb(theme.colors.text));
    await expect(question).toHaveCSS("color", rgb(theme.colors.surface));
    // 回答是問題下方獨立的卡片
    const body = answer.locator(".answer__body");
    await expect(body).toHaveCSS("border-top-style", "solid");
    expect((await body.boundingBox())!.y).toBeGreaterThan((await question.boundingBox())!.y + (await question.boundingBox())!.height);
    // 自由提問是回答下方的單行輸入列
    await expect(page.locator(".composer--line input")).toBeVisible();
    await expect(page.locator(".composer textarea")).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);

    // 原文：浮在右側的圓角卡片（離右緣 40px、有陰影），回答卡片讓到它的左邊
    const citation = answer.getByRole("button", { name: "1", exact: true });
    await citation.click();
    const panel = sourcePanel(page);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS("border-top-left-radius", "24px");
    await expect(panel).not.toHaveCSS("box-shadow", "none");
    // 滑入的動畫（kSlideIn）結束後量
    await expect.poll(async () => rightGap(page, (await panel.boundingBox())!)).toBe(40);
    const box = (await panel.boundingBox())!;
    await expect.poll(async () => { const b = (await body.boundingBox())!; return b.x + b.width <= box.x; }).toBe(true);
    await expect(panel.getByRole("button", { name: s.closeSource })).toContainText("Esc");
    // 輸入列也讓到原文卡片左邊：「提問」按鈕看得到、沒有被原文卡片蓋住
    const submit = page.locator(".composer--line button[type=submit]");
    await expect(submit).toBeInViewport();
    await expect.poll(async () => { const b = (await submit.boundingBox())!; return b.x + b.width <= box.x; }).toBe(true);
    const submitBox = (await submit.boundingBox())!;
    expect(
      await submit.evaluate((el, { x, y }) => el.contains(document.elementFromPoint(x, y)), { x: submitBox.x + submitBox.width / 2, y: submitBox.y + submitBox.height / 2 }),
    ).toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
    await testInfo.attach("presentation-qa-1920.png", { body: await page.screenshot(), contentType: "image/png" });

    // Esc 關閉原文，焦點回到引用標號
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(citation).toBeFocused();
  });

  test("圖譜：畫布不套卡片、左上麵包屑、右側卡片；沒有搜尋、篩選與找路徑，/ 不作用", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openTab(page, s.tabGraph);
    const canvas = ".graph-page .graph-canvas";
    await waitForGraphIdle(page, canvas);
    await expect(page.getByRole("combobox", { name: s.graphSearch })).toHaveCount(0);
    await expect(page.getByRole("button", { name: s.graphFindPath })).toHaveCount(0);
    await expect(page.getByRole("list", { name: s.legend })).toHaveCount(0);
    await expect(page.locator(".graph-stage")).toHaveCSS("border-top-style", "none");
    const crumbs = page.getByRole("navigation", { name: s.graphZoom.breadcrumb });
    await expect(crumbs.getByRole("button", { name: s.graphZoom.all })).toHaveAttribute("aria-current", "step");

    // 從右側卡片的「關聯最多」選一個實體：麵包屑「全部 › 名稱」、關聯是 surfaceRaised 的列
    await page.getByRole("region", { name: s.graphTopConnected }).getByRole("listitem").first().getByRole("button").click();
    const card = page.locator(".graph-stage-card section.entity");
    await expect(card).toBeVisible();
    const name = (await card.getByRole("heading", { level: 2 }).innerText()).trim();
    await expect(crumbs.getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "step");
    const rows = card.locator(".entity-row");
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toHaveCSS("background-color", rgb(theme.colors.surfaceRaised));
    // 每個實體一列（同一個實體的多則關係合併成「隸屬 · 負責」）
    const rowNames = await rows.locator("button.link").allInnerTexts();
    expect(new Set(rowNames).size).toBe(rowNames.length);
    // 「出現的文件」標題下方直接接引用段落（不留大段空白）
    const sourcesHeading = (await card.getByRole("heading", { level: 3, name: s.entitySources }).boundingBox())!;
    const documents = (await card.locator(".entity-documents").boundingBox())!;
    expect(documents.y - (sourcesHeading.y + sourcesHeading.height)).toBeLessThanOrEqual(24);
    const cardBox = (await page.locator(".graph-stage-card").boundingBox())!;
    expect(await rightGap(page, cardBox)).toBe(40);
    expect((await page.locator(canvas).boundingBox())!.x + (await page.locator(canvas).boundingBox())!.width).toBeLessThanOrEqual(cardBox.x);
    expect(await noHorizontalScroll(page)).toBe(true);
    await testInfo.attach("presentation-graph-1920.png", { body: await page.screenshot(), contentType: "image/png" });

    // 鍵盤操作（#289）照常：Tab 從「全部」進入外框；沒有搜尋框時 / 不作用、不報錯，焦點留在外框
    const frame = page.getByRole("application", { name: s.graphKeyboard.label });
    await crumbs.getByRole("button").last().focus();
    await page.keyboard.press("Tab");
    await expect(frame).toBeFocused();
    await page.keyboard.type("/");
    await expect(frame).toBeFocused();
    // Esc 回到全部：右側卡片換回「關聯最多」
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: s.graphTopConnected })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

// 手機寬度（#255）：展示模式登入後仍是頂端列，不會同時出現手機的頂端列、分段切換或分頁列（App 只渲染一種導覽）
test.describe("手機寬度", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("只有展示模式的頂端列，沒有手機的導覽", async ({ page }) => {
    await expect(identitySegments(page)).toBeVisible();
    await expect(page.locator(".presentation-bar")).toHaveCount(1);
    await expect(page.locator(":is(.mobile-topbar, .mobile-segmented, .mobile-tabbar, .sidebar)")).toHaveCount(0);
    await expect(page.locator(".app")).not.toHaveClass(/app--phone/);
  });
});
