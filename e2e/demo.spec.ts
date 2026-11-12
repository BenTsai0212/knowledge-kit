// 線上 demo 的設定（#100，docs/qa.md「線上 demo」）：只在 VITE_ONLINE_DEMO=1 的 build 執行（playwright.config.ts）。
// 公開試用碼預先填入、問答與上傳頁的提醒、評測台隱藏，上傳與待審照常可用。/api/ask 一律是假的回應。
import { expect, test, type Page } from "@playwright/test";
import { accountOption, blockModelDownload, openTab, presetQuestions, s, switchIdentity, tab, signInPanel, uploadAndReview } from "./support/app";
import { NO_REVIEWER, NO_REVIEWING_UPLOADER, reviewer, reviewingUploader } from "./support/client";
import { FAKE_ANSWER_LEAD, routeFakeAsk } from "./support/fake-ask";

// build 時帶入的公開試用碼；測試與 build 用同一個值（.github/workflows/e2e.yml 的 demo job）
const PUBLIC_CODE = process.env.VITE_PUBLIC_ACCESS_CODE ?? "";
if (PUBLIC_CODE.trim() === "") throw new Error("demo.spec.ts 需要 VITE_PUBLIC_ACCESS_CODE（與 build 時相同的值）");

test.beforeEach(async ({ page }) => {
  await blockModelDownload(page);
  await routeFakeAsk(page);
  await page.goto("/");
});

// 以「使用邀請碼體驗」進入（#287），不輸入邀請碼，直接按送出；等資料庫載入完成（預設問題的按鈕可以按）
async function start(page: Page, opened = false): Promise<void> {
  if (!opened) await page.getByRole("button", { name: s.signInWithCode }).click();
  await page.getByRole("button", { name: s.accessCodeSubmit }).click();
  await expect(page.getByRole("button", { name: presetQuestions[0].text, exact: true })).toBeEnabled();
}

test("公開試用碼已預先填入，按送出就能提問；問答頁提醒問題會傳給模型供應商", async ({ page }) => {
  await page.getByRole("button", { name: s.signInWithCode }).click();
  await expect(page.getByLabel(s.accessCodeLabel)).toHaveValue(PUBLIC_CODE.trim());
  await expect(page.getByText(s.demoAccessCodeHint)).toBeVisible();
  await start(page, true);
  await expect(page.getByText(s.demoQaNotice)).toBeVisible();

  const question = presetQuestions[0];
  await switchIdentity(page, question.role);
  const request = page.waitForRequest("**/api/ask");
  await page.getByRole("button", { name: question.text, exact: true }).click();
  expect((await request).headers()["x-access-code"]).toBe(PUBLIC_CODE.trim());
  await expect(page.locator("section.answer")).toContainText(FAKE_ANSWER_LEAD);
});

test("評測台隱藏，待審保留", async ({ page }) => {
  test.skip(reviewer === undefined, NO_REVIEWER);
  await start(page);
  await switchIdentity(page, reviewer!.id);
  await expect(tab(page, s.tabReview)).toBeVisible();
  await expect(tab(page, s.tabEvals)).toHaveCount(0);
});

test("網址帶 tools=evals 時評測台仍然隱藏", async ({ page }) => {
  test.skip(reviewer === undefined, NO_REVIEWER);
  await page.goto("/?tools=evals");
  await start(page);
  await switchIdentity(page, reviewer!.id);
  await expect(tab(page, s.tabReview)).toBeVisible();
  await expect(tab(page, s.tabEvals)).toHaveCount(0);
});

test("上傳頁提醒內容會傳給模型供應商；上傳後萃取的實體出現在待審", async ({ page }) => {
  test.skip(reviewingUploader === undefined, NO_REVIEWING_UPLOADER);
  await start(page);
  await switchIdentity(page, reviewingUploader!.id);
  await openTab(page, s.tabUpload);
  await expect(page.getByText(s.demoUploadNotice)).toBeVisible();
  await uploadAndReview(page);
});

test("帳號登入（#287）：不用輸入邀請碼，以公開碼送出；身分固定", async ({ page }) => {
  const question = presetQuestions[0];
  const panel = signInPanel(page);
  await expect(panel.getByLabel(s.accessCodeLabel)).toHaveCount(0);
  await panel.getByLabel(s.signInAccount).selectOption({ label: accountOption(question.role) });
  await panel.getByRole("button", { name: s.signInSubmit }).click();
  await expect(page.getByRole("button", { name: question.text, exact: true })).toBeEnabled();
  await expect(page.getByRole("banner").getByLabel(s.identity)).toHaveCount(0);

  const request = page.waitForRequest("**/api/ask");
  await page.getByRole("button", { name: question.text, exact: true }).click();
  expect((await request).headers()["x-access-code"]).toBe(PUBLIC_CODE.trim());
  await expect(page.locator("section.answer")).toContainText(FAKE_ANSWER_LEAD);
});
