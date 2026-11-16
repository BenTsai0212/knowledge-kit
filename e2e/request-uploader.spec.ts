// 請上傳者確認（ADR 0011 決定 6，#378 PR 5b，畫板 docs/design/v1/boards/S-Review.dc.html、S-Request.dc.html）：一般員工上傳試用紀錄
// （fixtures/seam-notice.md，虛構；萃取是假的 /api/ask），主管在接縫選「我不確定，請上傳者確認」→ 項目保留、不顯示選項；
// 一般員工在首頁「有更新」作答 → 已送出；主管的卡片附上上傳者的回答，選項照常。依參考情境的圖譜，其他客戶略過。
// 截圖附在測試報告（request-*.png），審查時與畫板並排比對
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { language, openApp, openTab, s, seams, switchIdentity, upload } from "./support/app";
import { clientName, nonReviewingUploader, reviewer } from "./support/client";
import { SEAM_TITLE } from "./support/fake-ask";

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("主管請上傳者確認 → 上傳者在首頁作答 → 主管看到回答", async ({ page }, testInfo) => {
  test.skip(clientName !== "", "試用紀錄依參考情境的圖譜（client/）");
  test.skip(!seams, "參考情境的 client.json 應為 review.mode: seams");
  const staff = nonReviewingUploader!;
  const manager = reviewer!;
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await switchIdentity(page, staff.id);
  await upload(page, { file: "seam-notice.md", title: SEAM_TITLE, visibility: "internal" });

  // 主管：等接縫出現（萃取與直接收錄在背景執行，按重新整理再讀），對第一個接縫請上傳者確認
  await switchIdentity(page, manager.id);
  await openTab(page, s.tabReview);
  const card = page.locator("section.review-doc").filter({ hasText: SEAM_TITLE });
  const ask = card.locator(".review-seams .ask-card").first();
  const request = ask.getByRole("button", { name: s.seamRequest });
  await expect(async () => {
    await page.getByRole("button", { name: s.reviewRefresh }).first().click();
    await expect(request).toBeVisible({ timeout: 2_000 });
  }).toPass();
  const question = (await ask.locator(".refusal-ask__question").textContent())!;
  await request.click();
  const held = card.locator(".review-seams .ask-card").filter({ hasText: question });
  await expect(held.locator(".ask-card__pill")).toHaveText(s.seamHeld);
  await expect(held.locator(".refusal-ask__options")).toHaveCount(0);
  await screenshot(page, testInfo, "request-held-1440px.png");

  // 一般員工：首頁「有更新」最上面是同樣的提問，小標是誰在問、哪一份文件
  await switchIdentity(page, staff.id);
  await openTab(page, s.tabHome);
  const updates = page.getByRole("region", { name: s.home.updatesTitle });
  const title = fill(s.seamRequestTitle, { name: manager.label[language], title: SEAM_TITLE });
  const mine = updates.getByRole("group", { name: title });
  await expect(mine).toBeVisible();
  await expect(mine.getByRole("button", { name: s.commonExplain })).toBeVisible();
  await expect(mine.getByRole("button", { name: s.seamRequest })).toHaveCount(0);
  await screenshot(page, testInfo, "request-home-1440px.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, testInfo, "request-home-390px.png");
  await page.setViewportSize({ width: 1440, height: 900 });

  const option = mine.locator(".refusal-ask__options button").first();
  const answer = (await option.textContent())!;
  await option.click();
  await expect(mine.locator(".refusal-chosen__choice")).toHaveText(answer);
  await expect(mine).toContainText(fill(s.seamRequestSent, { name: manager.label[language] }));
  await expect(mine.locator(".refusal-ask__options")).toHaveCount(0);

  // 主管：卡片附上上傳者的回答，選項照常、不再有「請上傳者確認」
  await switchIdentity(page, manager.id);
  await openTab(page, s.tabReview);
  await page.getByRole("button", { name: s.reviewRefresh }).first().click();
  const replied = card.locator(".review-seams .ask-card").filter({ hasText: question });
  await expect(replied.locator(".ask-card__reply")).toContainText(staff.label[language]);
  await expect(replied.locator(".refusal-ask__options button").first()).toBeVisible();
  await expect(replied.getByRole("button", { name: s.seamRequest })).toHaveCount(0);
  await screenshot(page, testInfo, "request-reply-1440px.png");
});
