// 手機的時間軸與上傳（#358，畫板 docs/design/v1/boards/G-Mobile-Pages.dc.html 第 1、2 張、K-Mobile.dc.html 第 5 張）：390×844。
// 時間軸：h1 與文件數、日期是 MM-DD（年份在分組標題）、卡片預設沒有段落清單（展開後才有）。
// 上傳：h1 與分段切換、頁面不包卡片、提示是說明列、確認視窗只有一個進度；我的上傳每份一列，點一列打開底部面板的詳情。
// 「更多」的數字是 0 時沒有徽章。每一步檢查沒有橫向捲動、觸控目標至少 44px，截圖附在測試報告（CI 的 E2E artifact）。
// /api/ask 一律是假的回應（openApp）
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { field, gotoView, openApp, s, switchIdentity } from "./support/app";
import { NO_REVIEWER, NO_UPLOADER, nonReviewer, reviewer, uploader } from "./support/client";
import { FAKE_ENTITY_NAME } from "./support/fake-ask";

test.use({ viewport: { width: 390, height: 844 } });

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const tokenColor = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--color-${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
async function expectTouchTargets(targets: Locator): Promise<void> {
  const sizes = await targets.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.width, r.height]));
  expect(sizes.length).toBeGreaterThan(0);
  for (const [width, height] of sizes) {
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
}
const screenshot = async (page: Page, testInfo: TestInfo, name: string) =>
  testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

test("時間軸：h1 與文件數、MM-DD 日期與年份標題、卡片預設沒有段落清單，展開後才有", async ({ page }, testInfo) => {
  await openApp(page);
  if (nonReviewer !== undefined) await switchIdentity(page, nonReviewer.id);
  expect(await gotoView(page, "timeline")).toBe(true);
  const rows = page.locator("ol.timeline > li");
  await expect(rows.first()).toBeVisible();

  await expect(page.getByRole("heading", { level: 1, name: s.tabTimeline })).toBeVisible();
  const total = await rows.count();
  await expect(page.locator(".timeline-head p")).toContainText(String(total));

  const dates = await page.locator(".timeline-year .timeline-date").allInnerTexts();
  expect(dates.length).toBeGreaterThan(0);
  for (const date of dates) expect(date.trim()).toMatch(/^\d{2}-\d{2}$/);
  for (const year of await page.locator(".timeline-year h2").allInnerTexts()) expect(year.trim()).toMatch(/^\d{4}$/);

  // 精簡卡片：段落清單與「打開原文」不直接列出，也沒有「提到」
  await expect(page.locator(".timeline-passages")).toHaveCount(0);
  await expect(page.getByRole("button", { name: s.openSource })).toHaveCount(0);
  await expect(page.locator(".timeline-mentions, .timeline-mentions-line")).toHaveCount(0);
  const first = rows.first();
  const toggle = first.locator("button.timeline-toggle");
  await expectTouchTargets(toggle);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "timeline-390px.png");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(first.locator(".timeline-passages")).toBeVisible();
  await expect(first.getByRole("button", { name: s.openSource }).first()).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("上傳：h1 與分段切換、提示是說明列、確認視窗只有一個進度；我的上傳點一列打開底部面板", async ({ page }, testInfo) => {
  test.skip(uploader === undefined, NO_UPLOADER);
  const title = "E2E mobile upload";
  await openApp(page);
  await switchIdentity(page, uploader!.id);
  expect(await gotoView(page, "upload")).toBe(true);

  // 頁首：h1 與分段切換，頁面不包一張卡片
  const root = page.locator(".upload-page--phone");
  await expect(root.getByRole("heading", { level: 1, name: s.tabUpload })).toBeVisible();
  const tabs = root.getByRole("tablist", { name: s.myUploads.sections });
  const newTab = tabs.getByRole("tab", { name: s.myUploads.tabNew });
  const mineTab = tabs.getByRole("tab", { name: s.myUploads.tabMine });
  await expect(newTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("section.card.upload")).toHaveCount(0);
  // 提示：surfaceRaised 底的說明列，不是外框
  const hint = root.locator(".upload-hint");
  await expect(hint).toHaveCSS("background-color", await tokenColor(page, "surfaceRaised"));
  await expect(hint).toHaveCSS("border-top-style", "none");
  await expectTouchTargets(tabs.getByRole("tab"));
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "upload-new-390px.png");

  // 確認視窗：只有五段進度列與目前步驟；沒有四步進度與萃取的進度條
  await page.getByPlaceholder(s.uploadPastePlaceholder).fill(`${FAKE_ENTITY_NAME} 負責檢查手機的上傳頁。`);
  await field(page, s.uploadDocTitle, "input").fill(title);
  await page.getByRole("button", { name: s.uploadPreview }).click();
  const dialog = page.getByRole("dialog", { name: s.uploadConfirmTitle });
  await dialog.getByRole("button", { name: s.uploadSubmit, exact: true }).click();
  await expect(dialog.getByText(s.uploadDone)).toBeVisible();
  await expect(dialog.locator(".upload-bar")).toHaveCount(1);
  await expect(dialog.locator(".review-progress")).toHaveCount(0);
  await expect(dialog.locator(".extraction")).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "upload-submitted-390px.png");
  await dialog.getByRole("button", { name: s.uploadAnother }).click();
  await expect(dialog).toBeHidden();

  // 我的上傳：每份一列，狀態膠囊在右
  await mineTab.click();
  await expect(mineTab).toHaveAttribute("aria-selected", "true");
  const row = root.locator(".my-upload").filter({ hasText: title });
  await expect(row.locator(".badge")).toHaveText(s.myUploads.statusInReview);
  await expect(row).toHaveCSS("background-color", await tokenColor(page, "surfaceRaised"));
  await expectTouchTargets(root.locator(".my-upload"));
  expect(await noHorizontalScroll(page)).toBe(true);

  // 點一列：底部面板升起，內容與桌機的上傳詳情相同（摘要句，不顯示處理紀錄）
  await row.click();
  const sheet = page.locator("dialog.upload-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: title })).toBeVisible();
  await expect(sheet.locator(".bottom-sheet__actions .badge")).toHaveText(s.myUploads.statusInReview);
  await expect(sheet.locator(".upload-detail__items li").filter({ hasText: FAKE_ENTITY_NAME })).toContainText(s.myUploads.statusInReview);
  await expect(sheet.locator(".upload-detail__summary")).toContainText(s.myUploads.noteInReview);
  await expect(sheet.locator(".extraction")).toHaveCount(0);
  const sheetBox = (await sheet.boundingBox())!;
  expect(sheetBox.y + sheetBox.height).toBeCloseTo(844, 0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "upload-detail-390px.png");

  await sheet.getByRole("button", { name: s.dialogClose }).click();
  await expect(sheet).toBeHidden();
});

test("「更多」：待審與回報都沒有時沒有徽章，有時是正整數", async ({ page }) => {
  test.skip(reviewer === undefined, NO_REVIEWER);
  await openApp(page);
  await switchIdentity(page, reviewer!.id);
  expect(await gotoView(page, "home")).toBe(true);
  // 首頁的「等你處理」與徽章用同一次讀取的結果：讀完後才判斷
  const waiting = page.locator(".home__waiting");
  await expect(waiting).toBeVisible();
  await expect(waiting.getByText(s.loading)).toHaveCount(0);
  const none = (await waiting.getByText(s.home.waitingNone).count()) > 0;
  const badge = page.locator('.mobile-tabbar [data-view="more"] .tab-count');
  if (none) await expect(badge).toHaveCount(0);
  else await expect(badge).toHaveText(/^[1-9]\d*$/);

  await page.locator('.mobile-tabbar [data-view="more"]').click();
  const listed = page.locator('dialog.more-sheet [data-view="review"] .tab-count');
  if (none) await expect(listed).toHaveCount(0);
  else await expect(listed).toHaveText(/^[1-9]\d*$/);
});
