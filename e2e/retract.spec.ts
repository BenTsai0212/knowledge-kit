// 撤回（ADR 0007，#209）：核准後的「撤銷」、圖譜面板的「撤回此文件對它的核准」。撤回後圖譜搜尋不到、項目回到待審。
// 上傳與萃取是假的 /api/ask（support/fake-ask.ts，萃取出一個新實體 FAKE_ENTITY_NAME）；需要同時能上傳與審查的身分
import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, s, switchIdentity, uploadAndReview } from "./support/app";
import { NO_REVIEWING_UPLOADER, reviewingUploader } from "./support/client";
import { FAKE_ENTITY_NAME } from "./support/fake-ask";

const card = (page: Page) => page.locator("section.review-doc").filter({ hasText: FAKE_ENTITY_NAME });
const toast = (page: Page) => page.locator(".toast");
const search = (page: Page) => page.getByRole("combobox", { name: s.graphSearch, exact: true });

// 上傳並核准整份文件（只有 FAKE_ENTITY_NAME 一筆）
async function uploadAndApprove(page: Page): Promise<void> {
  await openApp(page);
  await switchIdentity(page, reviewingUploader!.id);
  await uploadAndReview(page);
  await card(page).getByRole("button", { name: s.reviewApproveDocument }).click();
  await expect(toast(page)).toContainText(s.reviewToastApprovedOne.replace("{name}", FAKE_ENTITY_NAME));
}

// 圖譜頁搜尋 FAKE_ENTITY_NAME：found 時選取它，否則確認搜尋不到
async function searchGraph(page: Page, found: boolean): Promise<void> {
  await openTab(page, s.tabGraph);
  await search(page).fill(FAKE_ENTITY_NAME);
  const option = page.getByRole("option", { name: new RegExp(`^${FAKE_ENTITY_NAME}`) });
  if (found) {
    await option.click();
    await expect(page.getByRole("region", { name: FAKE_ENTITY_NAME })).toBeVisible();
  } else {
    await expect(page.getByText(s.graphSearchNone)).toBeVisible();
    await expect(option).toHaveCount(0);
  }
}

test("核准後按「撤銷」：項目回到待審，圖譜搜尋不到", async ({ page }) => {
  test.skip(reviewingUploader === undefined, NO_REVIEWING_UPLOADER);
  await uploadAndApprove(page);
  await expect(card(page)).toHaveCount(0);

  await toast(page).getByRole("button", { name: s.reviewUndo }).click();
  await expect(toast(page)).toContainText(s.reviewToastUndone);
  await expect(toast(page).getByRole("button", { name: s.reviewUndo })).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: s.reviewApproveDocument })).toBeVisible();

  await searchGraph(page, false);
});

test("圖譜面板的「撤回此文件對它的核准」：先列出會消失的實體，確認後圖譜搜尋不到、項目回到待審", async ({ page }) => {
  test.skip(reviewingUploader === undefined, NO_REVIEWING_UPLOADER);
  await uploadAndApprove(page);
  await searchGraph(page, true);

  const panel = page.getByRole("region", { name: FAKE_ENTITY_NAME });
  // 撤回是小型外框按鈕（button.chip），不是與文件標題相同的連結樣式
  const retract = panel.getByRole("button", { name: s.graphRetract });
  await expect(retract).toHaveClass(/\bchip\b/);
  await expect(retract).not.toHaveClass(/\blink\b/);
  await retract.click();
  const confirm = panel.getByRole("group", { name: s.graphRetract });
  await expect(confirm).toContainText(s.graphRetractWillRemove);
  await expect(confirm.getByRole("listitem")).toHaveText([FAKE_ENTITY_NAME]);
  // 取消時不撤回
  await confirm.getByRole("button", { name: s.graphRetractCancel }).click();
  await expect(confirm).toHaveCount(0);

  await retract.click();
  await confirm.getByRole("button", { name: s.graphRetractConfirm }).click();
  await expect(panel).toHaveCount(0);
  await search(page).fill(FAKE_ENTITY_NAME);
  await expect(page.getByText(s.graphSearchNone)).toBeVisible();

  await openTab(page, s.tabReview);
  await expect(card(page).getByRole("button", { name: s.reviewApproveDocument })).toBeVisible();
});
