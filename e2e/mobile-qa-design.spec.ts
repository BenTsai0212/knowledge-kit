// 手機的問答與原文面板對齊設計稿（#354，畫板 docs/design/v1/boards/G-Mobile-QA.dc.html）：390×844 時問題是右對齊的泡泡（text 底、surface 字），
// 回答卡片沿用桌機（#335）的樣式；輸入區是單行輸入列（input、「提問」在框內、Enter 送出），在分頁列上方；原文面板的標題是「原文 · 出處 N／M」，
// 未引用的段落是 textMuted，下方是並排的按鈕。觸控目標至少 44px，每一步都沒有橫向捲動；英文介面不破版。截圖附在測試報告（CI 的 E2E artifact）。
// /api/ask 一律是假的回應。
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openApp, presetQuestions, s, switchLanguage } from "./support/app";
import { askWithSeveralSources } from "./support/citing-answer";
import { client } from "./support/client";

test.use({ viewport: { width: 390, height: 844 } });

const sheet = (page: Page) => page.locator("dialog.source-sheet");
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (el: Locator) => (await el.boundingBox())!;
const sheetTitle = (n: number, total: number) => s.sourceSheetStep.replace("{n}", String(n)).replace("{total}", String(total));
// 等動態（回答的升起、面板進場、刷過）結束再量；無限循環的動態不等
const settle = (el: Locator) =>
  el.evaluate(async (node) => {
    const finite = node.getAnimations({ subtree: true }).filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
const tokenColor = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--color-${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

// 看得到的按鈕都至少 44×44px（引用標號的觸控範圍由 ::after 補，見 mobile-qa-layout.spec.ts）
async function expectTouchTargets(buttons: Locator) {
  for (const button of await buttons.all()) {
    if (!(await button.isVisible())) continue;
    const b = await box(button);
    expect(Math.min(b.width, b.height), await button.innerText()).toBeGreaterThanOrEqual(44);
  }
}

let answer: Locator;
let total: number;
let question: string;

test.beforeEach(async ({ page }) => {
  await openApp(page);
  const found = await askWithSeveralSources(page);
  test.skip(found === null, "預設問題都只檢索到 0 或 1 段，無法測試原文面板的出處");
  ({ answer, total } = found!);
  question = await answer.locator("h2").innerText();
  await settle(answer);
});

test("問題泡泡、回答卡片與單行輸入列照畫板；輸入列在分頁列上方；觸控目標至少 44px", async ({ page }, testInfo) => {
  // 問題是右對齊的泡泡：右緣與回答卡片對齊，比卡片窄，text 底、surface 字
  const bubble = answer.locator("h2");
  const body = answer.locator(".answer__body");
  const card = await box(body);
  const bubbleBox = await box(bubble);
  expect(Math.abs(bubbleBox.x + bubbleBox.width - (card.x + card.width))).toBeLessThanOrEqual(1);
  expect(bubbleBox.width).toBeLessThan(card.width);
  await expect(bubble).toHaveCSS("background-color", await tokenColor(page, "text"));
  await expect(bubble).toHaveCSS("color", await tokenColor(page, "surface"));
  // 回答卡片：surface 底、「根據 N 段原文回答」、本文 16px
  await expect(body).toHaveCSS("background-color", await tokenColor(page, "surface"));
  await expect(body.locator(".answer-basis")).toBeVisible();
  await expect(body.locator(".answer-basis")).toContainText(String(total));
  await expect(body.locator(".answer-text")).toHaveCSS("font-size", "16px");
  await expect(answer.locator("button.citation").first()).toHaveCSS("background-color", await tokenColor(page, "markSoft"));

  // 單行輸入列：input（不是 textarea），提問按鈕在框內，沒有情境角色的標籤，底邊貼齊分頁列
  const input = page.getByPlaceholder(s.questionPlaceholder);
  expect(await input.evaluate((el) => el.tagName)).toBe("INPUT");
  const row = page.locator(".composer--line .free-question");
  const frame = await box(row);
  const ask = await box(row.getByRole("button", { name: s.askButton, exact: true }));
  expect(ask.x + ask.width).toBeLessThanOrEqual(frame.x + frame.width);
  expect(frame.height).toBeLessThanOrEqual(64);
  await expect(page.locator(".composer--line .scenario > span").first()).toBeHidden();
  const composer = await box(page.locator("section.composer"));
  const bar = await box(page.locator(".mobile-tabbar"));
  expect(Math.abs(composer.y + composer.height - bar.y)).toBeLessThanOrEqual(1);
  // 預設問題一行
  const presets = page.locator(".presets button");
  const tops = await presets.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);

  // 「這次的問題（N）」保留（#256）
  await expect(page.locator(".session-questions-button")).toBeVisible();
  await expect(page.getByText(s.qaHeaderNote)).toBeVisible();

  await expectTouchTargets(page.locator("section.composer button"));
  await expectTouchTargets(answer.locator(".mentions button"));
  await expectTouchTargets(page.locator(".session-questions-button"));
  expect((await box(input)).height).toBeGreaterThanOrEqual(44);

  // Enter 送出（與按「提問」相同），送出後清空
  const before = await page.locator("section.answer").count();
  await input.fill("E2E");
  await input.press("Enter");
  await expect(page.locator("section.answer")).toHaveCount(before + 1);
  await expect(input).toHaveValue("");

  expect(await noHorizontalScroll(page)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot(page, testInfo, "qa-mobile-answer");
});

test("問題超過 500 字：輸入列的邊線換 danger、下方說明與字數、停用提問", async ({ page }) => {
  const input = page.getByPlaceholder(s.questionPlaceholder);
  await input.fill("問".repeat(501));
  await expect(page.getByText(s.errors.question_too_long)).toBeVisible();
  await expect(page.getByRole("button", { name: s.askButton, exact: true })).toBeDisabled();
  await expect(page.locator(".composer--line .free-question")).toHaveCSS("border-top-color", await tokenColor(page, "danger"));
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("原文面板：「原文 · 出處 1／M」、上一個／下一個 44px、未引用的段落是 textMuted、下方按鈕並排", async ({ page }, testInfo) => {
  await answer.locator("button.citation").first().click();
  const panel = sheet(page);
  await expect(panel).toBeVisible();
  await settle(panel);
  await expect(panel.getByRole("heading", { name: sheetTitle(1, total), exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { level: 2 })).toHaveCSS("color", await tokenColor(page, "textMuted"));
  // 關閉在標題列
  const header = await box(panel.locator(".bottom-sheet__header"));
  const close = await box(panel.getByRole("button", { name: s.dialogClose, exact: true }));
  expect(close.y).toBeGreaterThanOrEqual(header.y);
  expect(close.y + close.height).toBeLessThanOrEqual(header.y + header.height + 1);

  // 引用段落是螢光，其他段落是 textMuted（Light；Dark 的紙面是亮色，改用紙面文字）
  await expect(panel.locator(".source-text .highlight mark")).toBeVisible();
  const others = panel.locator(".source-text > p:not(.highlight)");
  if ((await others.count()) === 0) {
    test.info().annotations.push({ type: "skip-part", description: "這份文件只有引用的段落看得到，略過未引用段落的顏色" });
  } else {
    const scheme = await page.locator("html").getAttribute("data-scheme");
    await expect(others.first()).toHaveCSS("color", await tokenColor(page, scheme === "dark" ? "readingText" : "textMuted"));
  }

  // 下方的按鈕並排、高 48px；「在圖譜中查看」只在找得到實體時出現
  const actions = panel.locator(".source-sheet__actions button");
  const count = await actions.count();
  expect(count).toBeGreaterThan(0);
  const tops = await actions.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  for (const button of await actions.all()) expect((await box(button)).height).toBeGreaterThanOrEqual(48);
  await expectTouchTargets(panel.getByRole("button"));
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "qa-mobile-source");

  // Esc 關閉
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("英文版面（#288）：回答卡片、輸入列與原文面板不破版", async ({ page }, testInfo) => {
  test.skip(!client.languages.includes("en"), "client.json 的 languages 沒有 en");
  const index = presetQuestions.findIndex((q) => q.text === question);
  await switchLanguage(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.locator(".presets button").nth(index).click();
  const latest = page.locator("section.answer").last();
  await expect(latest.locator("button.citation").first()).toBeVisible();
  await settle(latest);
  for (const el of [latest.locator(".answer__body"), page.locator(".composer--line .free-question")])
    expect(await el.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "qa-mobile-en");

  await latest.locator("button.citation").first().click();
  const panel = sheet(page);
  await expect(panel).toBeVisible();
  await settle(panel);
  for (const el of [panel.locator(".bottom-sheet__header"), panel.locator(".source-sheet__actions")])
    expect(await el.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "qa-mobile-en-source");
});
