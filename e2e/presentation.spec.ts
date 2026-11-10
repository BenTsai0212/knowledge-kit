// 客戶展示模式（#129，docs/qa.md「展示模式」）：?mode=presentation 只顯示問答與圖譜兩個頁籤，能審查的身分也一樣。/api/ask 一律是假的回應。
import { expect, test } from "@playwright/test";
import { openApp, openTab, presetQuestions, s, sourcePanel, switchIdentity } from "./support/app";
import { access } from "./support/client";
import { FAKE_ANSWER_LEAD } from "./support/fake-ask";

test.beforeEach(async ({ page }) => {
  await openApp(page, "/?mode=presentation");
});

test("每個身分都只有問答與圖譜兩個頁籤", async ({ page }) => {
  const tabs = page.getByRole("navigation", { name: s.views }).getByRole("button");
  for (const role of access.roles) {
    await switchIdentity(page, role.id);
    await expect(tabs).toHaveText([s.tabQa, s.tabGraph]);
  }
});

test("與 tools=evals 併用：仍只有問答與圖譜", async ({ page }) => {
  // beforeEach 已輸入邀請碼（存在 sessionStorage），重新載入時不再要求輸入
  await page.goto("/?mode=presentation&tools=evals");
  await expect(page.getByRole("button", { name: presetQuestions[0].text, exact: true })).toBeEnabled();
  const tabs = page.getByRole("navigation", { name: s.views }).getByRole("button");
  for (const role of access.roles.filter((r) => r.canReview)) {
    await switchIdentity(page, role.id);
    await expect(tabs).toHaveText([s.tabQa, s.tabGraph]);
  }
});

test("問答：回答附出處，點出處打開原文；圖譜：畫出畫布", async ({ page }) => {
  const question = presetQuestions[0];
  await switchIdentity(page, question.role);
  await page.getByRole("button", { name: question.text, exact: true }).click();
  const answer = page.locator("section.answer");
  await expect(answer).toContainText(FAKE_ANSWER_LEAD);
  await answer.getByRole("button", { name: "1", exact: true }).click();
  await expect(sourcePanel(page)).toBeVisible();

  await openTab(page, s.tabGraph);
  await expect(page.locator(".graph-canvas canvas").first()).toBeVisible();
});
