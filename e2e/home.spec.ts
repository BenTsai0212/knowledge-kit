// 首頁（#283，docs/design.md「日常工具」的「首頁」）：登入後的預設頁；常見問題依身分；問過的問題只存文字，「再問一次」重新回答；
// 主管有「等你處理」，能上傳、不能審核的身分有「有更新」（#284）。展示模式不顯示首頁（presentation.spec.ts、sign-in.spec.ts）。/api/ask 一律是假的回應。
import { expect, test } from "@playwright/test";
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
  const start = waiting.getByRole("button", { name: s.home.startReview });
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
