// 手機版的時間軸、上傳、待審、評測台與更多（#282，docs/design.md「時間軸、上傳、待審、評測台與更多（手機）」）：375×812。
// 每一頁都檢查 375px 沒有橫向捲動、該頁新增的可點元件至少 44px（觸控目標）。橫向滑動的手感與 iOS 安全區由人在實機確認。
// /api/ask 一律是假的回應（openApp）。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { EVALS_PATH, gotoView, openApp, switchIdentity } from "./support/app";
import { NO_NON_REVIEWER, NO_REVIEWER, nonReviewer, reviewer } from "./support/client";

test.use({ viewport: { width: 375, height: 812 } });

// 共用的檢查：整頁沒有橫向捲動；元件的高度與寬度都至少 44px
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function expectTouchTargets(targets: Locator): Promise<void> {
  const sizes = await targets.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.width, r.height]));
  expect(sizes.length).toBeGreaterThan(0);
  for (const [width, height] of sizes) {
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
}

const moreSheet = (page: Page) => page.locator("dialog.more-sheet");
const moreItems = (page: Page) => moreSheet(page).locator(".more-list button");

test.describe("時間軸", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    if (nonReviewer !== undefined) await switchIdentity(page, nonReviewer.id);
    expect(await gotoView(page, "timeline")).toBe(true);
    await expect(page.locator("ol.timeline > li").first()).toBeVisible();
  });

  test("日期欄 46px，卡片佔滿其餘寬度；沒有橫向捲動", async ({ page }) => {
    const first = page.locator("ol.timeline > li").first();
    expect((await first.locator(".timeline-date").boundingBox())!.width).toBeCloseTo(46, 0);
    const card = (await first.locator(".timeline-card").boundingBox())!;
    const row = (await first.boundingBox())!;
    expect(card.x + card.width).toBeCloseTo(row.x + row.width, 0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("篩選晶片一行、橫向滑動，觸控目標至少 44px；不符合的卡片變淡（45%），不移除", async ({ page }) => {
    const filter = page.locator(".timeline-filter");
    const chips = filter.locator("button.chip");
    await expect(chips.nth(1)).toBeVisible();
    // 一行：每個晶片的頂端都相同；晶片比可見寬度多時在晶片列內捲動，不撐開整頁
    const tops = await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await filter.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
    await expectTouchTargets(chips);
    expect(await noHorizontalScroll(page)).toBe(true);

    // 依序點晶片，直到有文件不符合；文件數不變，不符合的卡片 45% 不透明
    const rows = page.locator("ol.timeline > li");
    const total = await rows.count();
    const dimmed = page.locator("ol.timeline > li.dimmed");
    const count = await chips.count();
    for (let i = 1; i < count && (await dimmed.count()) === 0; i++) await chips.nth(i).click();
    await expect(dimmed.first()).toBeVisible();
    await expect(rows).toHaveCount(total);
    await expect.poll(() => dimmed.first().locator(".timeline-card").evaluate((el) => getComputedStyle(el).opacity)).toBe("0.45");
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe("更多（主管）", () => {
  test.skip(reviewer === undefined, NO_REVIEWER);

  test("列出時間軸與待審，待審的數量標在清單上；沒有 ?tools=evals 時沒有評測台", async ({ page }) => {
    await openApp(page);
    await switchIdentity(page, reviewer!.id);
    await page.locator('.mobile-tabbar [data-view="more"]').click();
    await expect(moreSheet(page)).toBeVisible();
    expect(await moreItems(page).evaluateAll((bs) => bs.map((b) => b.getAttribute("data-view")))).toEqual(["timeline", "review"]);
    await expect(moreSheet(page).locator('[data-view="review"] .tab-count')).toHaveText(/^\d+$/);
    await expectTouchTargets(moreItems(page));
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("帶 ?tools=evals 時加上評測台", async ({ page }) => {
    await openApp(page, EVALS_PATH);
    await switchIdentity(page, reviewer!.id);
    await page.locator('.mobile-tabbar [data-view="more"]').click();
    expect(await moreItems(page).evaluateAll((bs) => bs.map((b) => b.getAttribute("data-view")))).toEqual(["timeline", "review", "evals"]);
    await expect(moreSheet(page).locator('[data-view="review"] .tab-count')).toHaveText(/^\d+$/);
  });
});

test("一般員工：分頁列沒有「更多」，時間軸在分頁列上", async ({ page }) => {
  test.skip(nonReviewer === undefined, NO_NON_REVIEWER);
  await openApp(page);
  await switchIdentity(page, nonReviewer!.id);
  await expect(page.locator('.mobile-tabbar [data-view="more"]')).toHaveCount(0);
  await expect(page.locator('.mobile-tabbar [data-view="timeline"]')).toBeVisible();
  await expectTouchTargets(page.locator(".mobile-tabbar button"));
});
