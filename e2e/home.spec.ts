// 首頁（#283，docs/design.md「日常工具」的「首頁」）：登入後的預設頁；常見問題依身分；問過的問題只存文字，「再問一次」重新回答；
// 主管有「等你處理」。展示模式不顯示首頁（presentation.spec.ts、sign-in.spec.ts）。/api/ask 一律是假的回應。
import { expect, test } from "@playwright/test";
import { ACCESS_CODE, blockModelDownload, language, presetQuestions, s, switchIdentity, tab } from "./support/app";
import { access, NO_NON_REVIEWER, NO_REVIEWER, nonReviewer, reviewer } from "./support/client";
import { FAKE_ANSWER_LEAD, routeFakeAsk } from "./support/fake-ask";

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
