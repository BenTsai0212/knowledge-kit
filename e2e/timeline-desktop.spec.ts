// 桌機的時間軸（#346，畫板 docs/design/v1/boards/F-Timeline.dc.html）：1440×900 時有 h1 與範圍、日期欄是 MM-DD（年份在分組標題）、
// 篩選後不相關的卡片 45% 不透明、沒有鎖頭的虛線框（#247）、卡片展開後才有段落與「打開原文」、沒有橫向捲動。
// 平板（820px）的時間軸不變。截圖附在報告（timeline-1440px.png、timeline-filtered-1440px.png）；英文的 1440px 在 english-layout.spec.ts。
// /api/ask 一律是假的回應（openApp）
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { gotoView, openApp, openTab, s, sourcePanel, switchIdentity } from "./support/app";
import { reviewer } from "./support/client";

const rows = (page: Page) => page.locator("ol.timeline > li");
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const screenshot = async (page: Page, testInfo: TestInfo, name: string) =>
  testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

test.describe("1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await openApp(page);
    if (reviewer !== undefined) await switchIdentity(page, reviewer.id);
    await openTab(page, s.tabTimeline);
    await expect(rows(page).first()).toBeVisible();
  });

  test("頁首、MM-DD 日期與年份標題、沒有鎖頭框、沒有橫向捲動", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { level: 1, name: s.tabTimeline })).toBeVisible();
    // 文件數只算畫面上的（目前身分看得到的）文件
    const total = await rows(page).count();
    await expect(page.locator(".timeline-head p")).toContainText(String(total));

    const dates = await page.locator(".timeline-year .timeline-date").allInnerTexts();
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.trim()).toMatch(/^\d{2}-\d{2}$/);
    for (const year of await page.locator(".timeline-year h2").allInnerTexts()) expect(year.trim()).toMatch(/^\d{4}$/);

    // 每一列都是看得到的文件的卡片；頁面中沒有虛線框（鎖頭框不實作，#247）
    await expect(page.locator(".timeline-card")).toHaveCount(total);
    const dashed = await page.locator(".timeline-page *").evaluateAll((els) => els.filter((el) => getComputedStyle(el).borderTopStyle === "dashed").length);
    expect(dashed).toBe(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, "timeline-1440px.png");
  });

  test("篩選後不相關的卡片 45% 不透明、不移除；篩選是一列", async ({ page }, testInfo) => {
    const chips = page.locator(".timeline-filter button.chip");
    const tops = await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);

    const total = await rows(page).count();
    const dimmed = page.locator("ol.timeline > li.dimmed");
    const count = await chips.count();
    for (let i = 1; i < count && (await dimmed.count()) === 0; i++) await chips.nth(i).click();
    await expect(dimmed.first()).toBeVisible();
    await expect(rows(page)).toHaveCount(total);
    await expect.poll(() => dimmed.first().locator(".timeline-card").evaluate((el) => getComputedStyle(el).opacity)).toBe("0.45");
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, "timeline-filtered-1440px.png");
  });

  test("卡片預設精簡，展開後列出段落與「打開原文」", async ({ page }) => {
    const first = rows(page).first();
    await expect(first.getByRole("button", { name: s.openSource })).toHaveCount(0);
    const toggle = first.locator("button.timeline-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await first.getByRole("button", { name: s.openSource }).first().click();
    await expect(sourcePanel(page)).toBeVisible();
  });
});

test.describe("平板 820px 不變", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("沒有頁首與展開按鈕，段落與「打開原文」照舊直接列出", async ({ page }) => {
    await openApp(page);
    expect(await gotoView(page, "timeline")).toBe(true);
    const first = rows(page).first();
    await expect(first).toBeVisible();
    await expect(page.locator(".timeline-head")).toHaveCount(0);
    await expect(page.locator(".timeline-toggle")).toHaveCount(0);
    await expect(first.getByRole("button", { name: s.openSource }).first()).toBeVisible();
  });
});
