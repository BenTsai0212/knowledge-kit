// 桌機的問答頁（#335，畫板 docs/design/v1/boards/QA.dc.html）：1440×900 時中間是頁首、對話（最寬 760px，問題是右對齊的泡泡）
// 與單行輸入列，右側是貼齊右緣的整高原文欄（360～440px，段落有 ¶N，下方「這次回答的出處」可切換）。每一步都檢查沒有橫向捲動，
// 截圖附在測試報告（CI 的 E2E artifact）。/api/ask 一律是假的回應。
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openApp, presetQuestions, s, sourcePanel, switchLanguage } from "./support/app";
import { askWithSeveralSources } from "./support/citing-answer";
import { client } from "./support/client";

const WIDTH = 1440;
const HEIGHT = 900;
test.use({ viewport: { width: WIDTH, height: HEIGHT } });

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (el: Locator) => (await el.boundingBox())!;
const paragraph = (n: number) => s.paragraphNumber.replace("{n}", String(n));
const heading = (n: number) => s.sourceHeading.replace("{n}", String(n));
// 等面板的動態（滑入、刷過）結束再量
const settle = (el: Locator) => el.evaluate(async (node) => void (await Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished))));
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

let answer: Locator;
let total: number;
// 找到的那一題的問題文字
let question: string;

test.beforeEach(async ({ page }) => {
  await openApp(page);
  const found = await askWithSeveralSources(page);
  test.skip(found === null, "預設問題都只檢索到 0 或 1 段，無法測試出處清單的切換");
  ({ answer, total } = found!);
  question = await answer.locator("h2").innerText();
});

test("頁首、對話寬度、問題泡泡、回答卡片與單行輸入列照畫板", async ({ page }, testInfo) => {
  const header = page.locator(".qa-header");
  await expect(header.getByRole("heading", { level: 1, name: s.tabQa })).toHaveCSS("font-size", "28px");
  await expect(header.getByText(s.qaHeaderNote)).toBeVisible();

  const bubble = answer.locator("h2");
  const body = answer.locator(".answer__body");
  const card = await box(body);
  expect(card.width).toBeLessThanOrEqual(760);
  // 問題是右對齊的泡泡：右緣與回答卡片對齊，比卡片窄，text 底、surface 字
  const bubbleBox = await box(bubble);
  expect(Math.abs(bubbleBox.x + bubbleBox.width - (card.x + card.width))).toBeLessThanOrEqual(1);
  expect(bubbleBox.width).toBeLessThan(card.width);
  await expect(bubble).toHaveCSS("background-color", await tokenColor(page, "text"));
  await expect(bubble).toHaveCSS("color", await tokenColor(page, "surface"));
  // 「根據 N 段原文回答」的 N 是引用到的段落數
  await expect(body.locator(".answer-basis")).toContainText(String(total));
  await expect(body.locator(".answer-text")).toHaveCSS("font-size", "17px");

  // 單行輸入列：input（不是 textarea），提問按鈕在框內
  const input = page.getByPlaceholder(s.questionPlaceholder);
  expect(await input.evaluate((el) => el.tagName)).toBe("INPUT");
  const row = page.locator(".composer--line .free-question");
  const ask = await box(row.getByRole("button", { name: s.askButton, exact: true }));
  const frame = await box(row);
  expect(ask.x + ask.width).toBeLessThanOrEqual(frame.x + frame.width);
  expect(frame.height).toBeLessThanOrEqual(64);
  expect(frame.width).toBeLessThanOrEqual(760);
  // Enter 送出（與按「提問」相同），送出後清空
  const before = await page.locator("section.answer").count();
  await input.fill("E2E");
  await input.press("Enter");
  await expect(page.locator("section.answer")).toHaveCount(before + 1);
  await expect(input).toHaveValue("");

  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "qa-desktop-answer");
});

test("問題超過 500 字：輸入列的邊線換 danger，下方說明與字數，停用提問", async ({ page }) => {
  const input = page.getByPlaceholder(s.questionPlaceholder);
  await input.fill("問".repeat(501));
  await expect(page.getByText(s.errors.question_too_long)).toBeVisible();
  await expect(page.getByRole("button", { name: s.askButton, exact: true })).toBeDisabled();
  await expect(page.locator(".composer--line .free-question")).toHaveCSS("border-top-color", await tokenColor(page, "danger"));
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("原文欄貼齊右緣、整個高度、寬 360～440px；段落有 ¶N，出處清單可切換；✕ 關閉後焦點回到引用標號", async ({ page }, testInfo) => {
  const citation = answer.locator("button.citation").first();
  await citation.click();
  const panel = sourcePanel(page);
  await expect(panel).toBeVisible();
  await settle(panel);
  const column = await box(panel);
  expect(Math.round(column.x + column.width)).toBe(WIDTH);
  expect(column.width).toBeGreaterThanOrEqual(360);
  expect(column.width).toBeLessThanOrEqual(440);
  expect(Math.round(column.y)).toBe(0);
  expect(Math.round(column.height)).toBe(HEIGHT);

  await expect(panel.getByText(heading(1), { exact: true })).toBeVisible();
  await expect(panel.getByText(paragraph(1), { exact: true })).toBeVisible();
  await expect(panel.locator(".highlight mark")).toBeVisible();

  // 「這次回答的出處」：與手機「出處 N／M」相同的資料（引用到的段落，一段一列）
  const list = panel.getByRole("navigation", { name: s.sourceCitedList });
  const items = list.getByRole("button");
  await expect(items).toHaveCount(total);
  await expect(items.nth(0)).toHaveAttribute("aria-current", "true");
  for (const item of await items.all()) expect((await box(item)).height).toBeGreaterThanOrEqual(44);
  await items.nth(1).click();
  await expect(panel.getByText(heading(2), { exact: true })).toBeVisible();
  await expect(items.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(items.nth(0)).not.toHaveAttribute("aria-current", "true");
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "qa-desktop-source");

  await panel.getByRole("button", { name: s.closeSource, exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(citation).toBeFocused();
});

test("英文版面（#288）：頁首、回答卡片、原文欄與輸入列不破版", async ({ page }, testInfo) => {
  test.skip(!client.languages.includes("en"), "client.json 的 languages 沒有 en");
  // 切換語言會清掉目前身分的對話：以同一題（預設問題的同一個位置）的英文再問一次
  const index = presetQuestions.findIndex((q) => q.text === question);
  await switchLanguage(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.locator(".presets button").nth(index).click();
  const latest = page.locator("section.answer").last();
  await expect(latest.locator("button.citation").first()).toBeVisible();
  await latest.locator("button.citation").first().click();
  const panel = page.locator("aside.source");
  await expect(panel).toBeVisible();
  await settle(panel);
  expect((await box(latest.locator(".answer__body"))).width).toBeLessThanOrEqual(760);
  for (const el of [page.locator(".qa-header"), panel, page.locator(".composer--line .free-question")])
    expect(await el.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "qa-desktop-en");
});
