// 手機版的時間軸、上傳、待審、評測台與更多（#282，docs/design.md「時間軸、上傳、待審、評測台與更多（手機）」）：375×812。
// 每一頁都檢查 375px 沒有橫向捲動、該頁新增的可點元件至少 44px（觸控目標）。橫向滑動的手感與 iOS 安全區由人在實機確認。
// /api/ask 一律是假的回應（openApp）。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { EVALS_PATH, gotoView, language, openApp, s, switchIdentity } from "./support/app";
import {
  client,
  knowledgeModel,
  NO_NON_REVIEWER,
  NO_REVIEWER,
  NO_REVIEWING_UPLOADER,
  NO_UPLOADER,
  nonReviewer,
  reviewer,
  reviewingUploader,
  uploader,
} from "./support/client";
import { FAKE_ENTITY_NAME, sseBody } from "./support/fake-ask";

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

test.describe("上傳", () => {
  test.skip(uploader === undefined, NO_UPLOADER);

  test("五步縮成一條進度列，下方一行寫目前步驟；不在上傳頁時萃取結束，「上傳」分頁的小點亮起，回到上傳頁後消失", async ({ page }) => {
    await openApp(page);
    await switchIdentity(page, uploader!.id);
    expect(await gotoView(page, "upload")).toBe(true);
    const bar = page.locator(".upload-bar").first();
    await expect(bar.locator(".upload-bar__segment")).toHaveCount(5);
    await expect(page.locator(".upload-steps")).toHaveCount(0);
    await expect(bar.locator(".upload-bar__current")).toHaveText(s.uploadStepUpload);
    expect(await noHorizontalScroll(page)).toBe(true);

    // 萃取的回應先擋住，切到其他頁後才放行（route.fallback() 交給 openApp 的假回應）
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/ask", async (route) => {
      await held;
      await route.fallback();
    });
    await page.getByLabel(s.uploadFile).setInputFiles("e2e/fixtures/upload-note.md");
    await page.getByRole("button", { name: s.uploadPreview }).click();
    const dialog = page.getByRole("dialog", { name: s.uploadConfirmTitle });
    await dialog.getByRole("button", { name: s.uploadSubmit, exact: true }).click();
    await expect(dialog.getByText(s.uploadDone)).toBeVisible();
    // 萃取中：上傳與切段的段填滿，目前步驟是模型萃取與批次
    await expect(dialog.locator('.upload-bar__segment[data-step="chunk"]')).toHaveClass(/is-done/);
    await expect(dialog.locator('.upload-bar__segment[data-step="extract"]')).toHaveClass(/is-active/);
    await expect(dialog.locator(".upload-bar__current")).toContainText(s.uploadStepExtract);
    expect(await noHorizontalScroll(page)).toBe(true);
    await dialog.getByRole("button", { name: s.uploadAnother }).click();
    await expect(dialog).toBeHidden();

    const dot = page.locator('.mobile-tabbar [data-view="upload"] .tab-dot');
    await expect(dot).toHaveCount(0);
    expect(await gotoView(page, "qa")).toBe(true);
    release();
    await expect(dot).toBeVisible();
    expect(await gotoView(page, "upload")).toBe(true);
    await expect(dot).toHaveCount(0);
  });
});

test.describe("待審", () => {
  test.skip(reviewingUploader === undefined, NO_REVIEWING_UPLOADER);
  test.skip(client.languages.length < 2, "名稱缺少語言的實體需要兩種以上的語言");

  test("分段切換一行、橫向捲動；缺少語言名稱的實體只顯示摘要與「›」，點了以底部面板處理；「核准這份文件的全部」固定在下方", async ({ page }) => {
    await openApp(page);
    await switchIdentity(page, reviewingUploader!.id);
    // 萃取的實體只有介面語言的名稱：需要補上其他語言，在手機上以底部面板處理（其他請求交給 openApp 的假回應）
    await page.route("**/api/ask", async (route) => {
      const body = route.request().postDataJSON() as { system?: string };
      if (!(body.system ?? "").startsWith("You extract entities")) return route.fallback();
      const entity = { key: "e1", type: knowledgeModel.entityTypes[0].id, names: { [language]: FAKE_ENTITY_NAME }, sources: [1] };
      await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(JSON.stringify({ entities: [entity], relations: [] })) });
    });
    expect(await gotoView(page, "upload")).toBe(true);
    await page.getByLabel(s.uploadFile).setInputFiles("e2e/fixtures/upload-note.md");
    await page.getByRole("button", { name: s.uploadPreview }).click();
    const upload = page.getByRole("dialog", { name: s.uploadConfirmTitle });
    await upload.getByRole("button", { name: s.uploadSubmit, exact: true }).click();
    await expect(upload.getByText(s.uploadDone)).toBeVisible();
    await upload.getByRole("button", { name: s.uploadAnother }).click();
    await expect(upload).toBeHidden();

    // 萃取在背景執行：到待審頁按重新整理，直到摘要列出現
    expect(await gotoView(page, "review")).toBe(true);
    const row = page.locator(".review-page--phone button.review-sheet-row").filter({ hasText: FAKE_ENTITY_NAME });
    await expect(async () => {
      await page.getByRole("button", { name: s.reviewRefresh }).first().click();
      await expect(row).toBeVisible({ timeout: 2_000 });
    }).toPass();
    const card = page.locator("section.review-doc").filter({ has: row });
    await expect(row).toContainText(s.reviewSheetNames);
    await expect(row).toContainText("›");
    // 列表上沒有名稱欄位與核准按鈕：在底部面板中處理
    await expect(card.locator(".review-entity")).toHaveCount(0);

    // 分段切換：一行、在列內橫向捲動
    const tabs = page.locator(".review-tabs [role=tab]");
    const tops = await tabs.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await page.locator(".review-tabs").evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");

    // 「核准這份文件的全部」固定在分頁列之上，在可見範圍內；卡片頁首沒有這個按鈕
    const approveAll = card.locator(".review-doc__approve-all");
    expect(await approveAll.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    await expect(approveAll.getByRole("button", { name: s.reviewApproveDocument })).toBeInViewport();
    await expect(card.locator(".review-doc__side").getByRole("button", { name: s.reviewApproveDocument })).toHaveCount(0);
    await expectTouchTargets(page.locator(".review-tabs [role=tab], .review-toolbar .icon-button, button.review-sheet-row, .review-doc__approve-all > button"));
    expect(await noHorizontalScroll(page)).toBe(true);

    // 點摘要列打開底部面板：補上缺少的名稱後確認，面板關閉、這份文件沒有遺留
    await row.click();
    const sheet = page.locator("dialog.review-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: FAKE_ENTITY_NAME })).toBeVisible();
    const missing = sheet.locator('input[aria-invalid="true"]');
    await expect(missing).toHaveCount(client.languages.length - 1);
    // 填好一種語言後欄位不再標示缺少：每次填第一個，直到沒有缺少的語言
    while ((await missing.count()) > 0) await missing.first().fill(FAKE_ENTITY_NAME);
    expect(await noHorizontalScroll(page)).toBe(true);
    await sheet.getByRole("button", { name: new RegExp(`^${s.reviewConfirm}`) }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator(".toast-region")).toContainText(FAKE_ENTITY_NAME);
    await expect(card).toHaveCount(0);
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
