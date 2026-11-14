// 桌機的待審頁（#345，畫板 docs/design/v1/boards/F-Review.dc.html、F-Empty.dc.html）：1440×900 時有 h1「待審」、
// 空狀態照 F-Empty（主要的下一步是 primary 按鈕）；上傳後萃取結果每組一列（至少 56px），確認是 primary 按鈕、退回是外框，
// 「編輯名稱」「出處」是列內的外框按鈕（不是底線連結），文件標頭有上傳者的膠囊；每一步都沒有橫向捲動，英文介面也不破版。
// 平板寬度不套用桌機的版面。截圖附在測試報告（review-*.png）。萃取是假的 /api/ask（support/fake-ask.ts）
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { gotoView, openApp, s, switchIdentity, switchLanguage, uploadAndReview } from "./support/app";
import { client, NO_REVIEWING_UPLOADER, reviewer, reviewingUploader } from "./support/client";
import { FAKE_ENTITY_NAME } from "./support/fake-ask";

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

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test.describe("1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("頁首、空狀態、萃取結果列與主要動作照畫板，沒有橫向捲動；英文也不破版", async ({ page }, testInfo) => {
    test.skip(reviewingUploader === undefined, NO_REVIEWING_UPLOADER);
    await openApp(page);
    await switchIdentity(page, reviewingUploader!.id);
    await gotoView(page, "review");

    const reviewPage = page.locator(".review-page--desktop");
    await expect(reviewPage.getByRole("heading", { level: 1, name: s.tabReview })).toHaveCSS("font-size", "28px");

    // 空狀態（F-Empty「待審 · 清空了」）：虛線框、說明、第一個下一步是 primary 按鈕
    const empty = reviewPage.locator(".empty-state");
    await expect(empty).toContainText(s.reviewEmpty);
    await expect(empty).toContainText(s.reviewEmptyReason);
    await expect(empty).toHaveCSS("border-top-style", "dashed");
    await expect(empty.getByRole("button", { name: s.reviewGotoGraph })).toHaveCSS("background-color", await tokenColor(page, "primary"));
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, "review-empty-1440px.png");

    await uploadAndReview(page);
    const doc = reviewPage.locator("section.review-doc").filter({ hasText: FAKE_ENTITY_NAME });
    // 填滿內容區：卡片比原本的最寬限制（960px）寬
    expect((await doc.boundingBox())!.width).toBeGreaterThan(960);
    // 文件標頭：上傳者的膠囊
    const uploaderName = reviewingUploader!.label[client.defaultLanguage];
    await expect(doc.locator(".review-uploader")).toHaveText(s.reviewUploadedBy.replace("{name}", uploaderName));

    // 萃取結果列：至少 56px、surfaceRaised 底；確認是 primary、退回是外框
    const row = doc.locator(".review-entity").filter({ hasText: FAKE_ENTITY_NAME }).first();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await expect(row).toHaveCSS("background-color", await tokenColor(page, "surfaceRaised"));
    const confirm = row.getByRole("button", { name: new RegExp(`^${s.reviewConfirm}`) });
    await expect(confirm).toHaveCSS("background-color", await tokenColor(page, "primary"));
    await expect(row.getByRole("button", { name: s.reviewReject, exact: true })).toHaveCSS("border-top-color", await tokenColor(page, "border"));
    // 編輯名稱、出處是外框按鈕，不是底線連結
    for (const button of [row.getByRole("button", { name: s.reviewEditNames }), row.getByRole("button", { name: s.reviewSources.replace("{count}", "1") })]) {
      await expect(button).toHaveCSS("text-decoration-line", "none");
      await expect(button).toHaveCSS("border-top-style", "solid");
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, "review-1440px.png");

    // 英文介面：同樣不破版
    test.skip(!client.languages.includes("en"), "client.json 的 languages 沒有 en");
    await switchLanguage(page, "en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(reviewPage.locator(".review-entity").filter({ hasText: FAKE_ENTITY_NAME }).first()).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, "review-en-1440px.png");
  });
});

test.describe("平板 900px", () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test("平板不套用桌機的待審版面（沒有 h1）", async ({ page }) => {
    test.skip(reviewer === undefined, "access.json 沒有 canReview 的身分");
    await openApp(page);
    await switchIdentity(page, reviewer!.id);
    expect(await gotoView(page, "review")).toBe(true);
    await expect(page.locator(".review-page")).toBeVisible();
    await expect(page.locator(".review-page--desktop")).toHaveCount(0);
    await expect(page.locator(".review-page").getByRole("heading", { level: 1 })).toHaveCount(0);
  });
});
