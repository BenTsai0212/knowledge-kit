// 首頁（#283，docs/design.md「日常工具」的「首頁」）：登入後的預設頁；常見問題依身分；問過的問題只存文字，「再問一次」重新回答；
// 主管有「等你處理」，能上傳、不能審核的身分有「有更新」（#284）。展示模式不顯示首頁（presentation.spec.ts、sign-in.spec.ts）。/api/ask 一律是假的回應。
import { expect, test, type Page } from "@playwright/test";
import { ACCESS_CODE, blockModelDownload, language, openTab, presetQuestions, s, switchIdentity, tab, upload, waitForReview } from "./support/app";
import { access, NO_NON_REVIEWER, NO_NON_REVIEWING_UPLOADER, NO_REVIEWER, nonReviewer, nonReviewingUploader, reviewer } from "./support/client";
import { FAKE_ANSWER_LEAD, FAKE_ENTITY_NAME, routeFakeAsk } from "./support/fake-ask";

const greetings = [s.home.morning, s.home.afternoon, s.home.evening];

test.beforeEach(async ({ page }) => {
  await blockModelDownload(page);
  await routeFakeAsk(page);
  await page.goto("/");
  await page.getByRole("button", { name: s.signInWithCode }).click();
  await page.getByLabel(s.accessCodeLabel).fill(ACCESS_CODE);
  await page.getByRole("button", { name: s.accessCodeSubmit }).click();
});

test("登入後先到首頁：問候是三種之一、不含身分名稱；常見問題只列目前身分的情境", async ({ page }) => {
  await expect(tab(page, s.tabHome)).toHaveAttribute("aria-current", "page");
  const greeting = page.locator(".home__top h2");
  expect(greetings).toContain(await greeting.textContent());

  const question = presetQuestions[0];
  await switchIdentity(page, question.role);
  const presets = page.getByRole("group", { name: s.home.commonQuestions });
  await expect(presets.getByRole("button", { name: question.text, exact: true })).toBeEnabled();
  for (const other of presetQuestions.filter((q) => q.role !== question.role)) {
    await expect(presets.getByRole("button", { name: other.text, exact: true })).toHaveCount(0);
  }
  const role = access.roles.find((r) => r.id === question.role)!;
  await expect(page.locator(".home__top")).not.toContainText(role.label[language]);
});

test("從首頁提問會到問答頁；問過的問題列在首頁，「再問一次」重新回答", async ({ page }) => {
  const question = presetQuestions[0];
  await switchIdentity(page, question.role);
  await expect(page.getByText(s.home.askedEmpty)).toBeVisible();
  await page.getByRole("button", { name: question.text, exact: true }).click();
  await expect(tab(page, s.tabQa)).toHaveAttribute("aria-current", "page");
  await expect(page.locator("section.answer").first()).toContainText(FAKE_ANSWER_LEAD);

  await tab(page, s.tabHome).click();
  const again = page.getByRole("button", { name: `${s.home.askAgain}${s.colon}${question.text}` });
  await expect(again).toBeEnabled();
  await again.click();
  await expect(tab(page, s.tabQa)).toHaveAttribute("aria-current", "page");
  await expect(page.locator("section.answer")).toHaveCount(2);
  await expect(page.locator("section.answer").last()).toContainText(FAKE_ANSWER_LEAD);
});

test("「等你處理」只給能審核的身分；「開始審核」到待審頁", async ({ page }) => {
  test.skip(reviewer === undefined || nonReviewer === undefined, reviewer === undefined ? NO_REVIEWER : NO_NON_REVIEWER);
  const waiting = page.getByRole("region", { name: s.home.waitingTitle });
  await switchIdentity(page, nonReviewer!.id);
  await expect(page.getByRole("region", { name: s.home.askedTitle })).toBeVisible();
  await expect(waiting).toHaveCount(0);

  await switchIdentity(page, reviewer!.id);
  await expect(waiting).toBeVisible();
  // 待審文件與說法不同各有一個「開始審核」（#331）
  const start = waiting.getByRole("button", { name: s.home.startReview }).first();
  // 沒有等著處理的事時沒有「開始審核」
  await expect(start.or(waiting.getByText(s.home.waitingNone))).toBeVisible();
  if ((await start.count()) > 0) {
    await start.click();
    await expect(tab(page, s.tabReview)).toHaveAttribute("aria-current", "page");
  }
});

test("有更新：一般員工上傳後是審核中，「查看進度」到我的上傳；主管核准後是已核准，「在圖譜中查看」打開核准的實體", async ({ page }) => {
  test.skip(nonReviewingUploader === undefined || reviewer === undefined, reviewer === undefined ? NO_REVIEWER : NO_NON_REVIEWING_UPLOADER);
  const title = "E2E updates note";
  const updates = page.getByRole("region", { name: s.home.updatesTitle });
  await switchIdentity(page, nonReviewingUploader!.id);
  await expect(updates).toBeVisible();
  await expect(updates.getByText(s.home.updatesEmpty)).toBeVisible();
  // 主管沒有「有更新」
  await switchIdentity(page, reviewer!.id);
  await expect(page.getByRole("region", { name: s.home.askedTitle })).toBeVisible();
  await expect(updates).toHaveCount(0);

  await switchIdentity(page, nonReviewingUploader!.id);
  await upload(page, { title });
  await openTab(page, s.tabHome);
  const item = updates.getByRole("listitem").filter({ hasText: title });
  // 萃取完成後重新讀取：審核中，附「主管核准後才會出現」的說明
  await expect(item.getByText(s.myUploads.statusInReview, { exact: true })).toBeVisible();
  await expect(item.getByText(s.myUploads.approvalNote)).toBeVisible();
  await item.getByRole("button", { name: `${s.home.viewProgress}${s.colon}${title}` }).click();
  await expect(tab(page, s.tabUpload)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("tab", { name: s.myUploads.tabMine })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("complementary", { name: title })).toBeVisible();

  // 主管核准整份文件
  await switchIdentity(page, reviewer!.id);
  await waitForReview(page);
  const card = page.locator("section.review-doc").filter({ hasText: FAKE_ENTITY_NAME });
  await card.getByRole("button", { name: s.reviewApproveDocument }).click();
  await expect(card).toHaveCount(0);

  await switchIdentity(page, nonReviewingUploader!.id);
  await openTab(page, s.tabHome);
  await expect(item.getByText(s.myUploads.statusApproved, { exact: true })).toBeVisible();
  await expect(item.getByText(s.myUploads.approvalNote)).toHaveCount(0);
  await item.getByRole("button", { name: `${s.viewInGraph}${s.colon}${title}` }).click();
  await expect(tab(page, s.tabGraph)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: FAKE_ENTITY_NAME })).toBeVisible();
});

// 桌機（#331，畫板 docs/design/v1/boards/K-Home.dc.html）：寬螢幕兩欄、提問框與卡片的列高 52px、沒有橫向捲動；截圖附在報告
test.describe("桌機 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const columns = (page: Page) => page.locator(".home__cards").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const height = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!.height;

  for (const who of ["一般員工", "主管"] as const) {
    test(`${who}：兩欄、提問框 52px、列 52px、沒有橫向捲動`, async ({ page }, testInfo) => {
      const role = who === "主管" ? reviewer : nonReviewer;
      test.skip(role === undefined, who === "主管" ? NO_REVIEWER : NO_NON_REVIEWER);
      await switchIdentity(page, role!.id);
      await expect(tab(page, s.tabHome)).toHaveAttribute("aria-current", "page");
      const cards = page.locator(".home__cards");
      await expect(cards.getByText(s.loading)).toHaveCount(0);
      // 可見範圍在左側欄的使用者卡，首頁不重複
      await expect(page.locator(".home__scope")).toHaveCount(0);

      expect(await columns(page)).toBe(2);
      const input = page.getByRole("textbox", { name: s.questionLabel });
      expect((await input.boundingBox())!.height).toBe(52);
      expect((await page.getByRole("button", { name: s.askButton, exact: true }).boundingBox())!.height).toBe(52);
      // 常見問題在輸入框下方
      const presets = page.getByRole("group", { name: s.home.commonQuestions });
      expect((await presets.boundingBox())!.y).toBeGreaterThan((await input.boundingBox())!.y);

      // 卡片的列：主管的「等你處理」、一般員工的「有更新」，沒有時看最近新增的文件
      const rows = page.locator(".home__row");
      if ((await rows.count()) > 0) expect(await height(page, ".home__row")).toBeGreaterThanOrEqual(52);
      expect(await noHorizontalScroll(page)).toBe(true);
      await testInfo.attach(`home-${role!.id}-1440px.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

      // 提問框：Enter 送出到問答頁
      await input.fill(presetQuestions[0].text);
      // 資料庫載入完成前不能送出
      await expect(page.getByRole("button", { name: s.askButton, exact: true })).toBeEnabled();
      await input.press("Enter");
      await expect(tab(page, s.tabQa)).toHaveAttribute("aria-current", "page");
      await tab(page, s.tabHome).click();
      const asked = page.getByRole("region", { name: s.home.askedTitle });
      await expect(asked.locator("time.home__when").first()).toHaveText(new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(0, "day"));
      expect(await height(page, ".home__asked .home__row")).toBeGreaterThanOrEqual(52);
    });
  }
});
