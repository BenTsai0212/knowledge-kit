// 客戶展示模式（#129，docs/qa.md「展示模式」）：?mode=presentation 只顯示問答與圖譜兩個頁籤，能審查的身分也一樣。/api/ask 一律是假的回應。
import { expect, test, type Page } from "@playwright/test";
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

// 以第一個預設問題的身分問一題，等回答出現
async function askFirst(page: Page) {
  const question = presetQuestions[0];
  await switchIdentity(page, question.role);
  await page.getByRole("button", { name: question.text, exact: true }).click();
  const answer = page.locator("section.answer");
  await expect(answer).toContainText(FAKE_ANSWER_LEAD);
  return answer;
}

// 字級與主題、隱藏與保留（#260，docs/design.md「展示模式」）
test("字級放大（--present-*），原文從右側覆蓋、寬 620px", async ({ page }) => {
  await expect(page.locator("html")).toHaveAttribute("data-mode", "presentation");
  await expect(page.locator("body")).toHaveCSS("font-size", "20px");
  const answer = await askFirst(page);
  await expect(answer.locator("h2")).toHaveCSS("font-size", "36px");
  await expect(answer.locator("h2")).toHaveCSS("font-weight", "700");
  await expect(answer.locator(".answer-text")).toHaveCSS("font-size", "28px");
  const citation = answer.getByRole("button", { name: "1", exact: true });
  await expect(citation).toHaveCSS("height", "36px");
  await expect(page.getByRole("banner").getByText(s.fictionalData, { exact: true })).toHaveCSS("font-size", "16px");

  await citation.click();
  const panel = sourcePanel(page);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("position", "fixed");
  await expect(panel).toHaveCSS("width", "620px");
  await expect(panel.locator(".source-text")).toHaveCSS("font-size", "22px");
});

test("預設 Light：系統是深色時也不跟隨", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "light");
});

test("隱藏「回報有錯」「這次的問題」「更換邀請碼」；保留標示、身分與語言", async ({ page }) => {
  const answer = await askFirst(page);
  await expect(answer.getByRole("button", { name: s.reportButton })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: s.sessionQuestions })).toHaveCount(0);
  await expect(page.getByRole("button", { name: s.changeAccessCode })).toHaveCount(0);
  const banner = page.getByRole("banner");
  await expect(banner.getByText(s.fictionalData, { exact: true })).toBeVisible();
  await expect(banner.getByText(s.demoPermissions, { exact: true })).toBeVisible();
  await expect(banner.getByLabel(s.identity)).toBeVisible();
  await expect(banner.getByLabel(s.language)).toBeVisible();
});

test("一般模式（不帶參數）：字級與隱藏的元素不變", async ({ page }) => {
  // beforeEach 已輸入邀請碼（存在 sessionStorage），重新載入時不再要求輸入
  await page.goto("/");
  await openTab(page, s.tabQa);
  expect(await page.locator("html").getAttribute("data-mode")).toBeNull();
  await expect(page.locator("body")).toHaveCSS("font-size", "16px");
  const answer = await askFirst(page);
  await expect(answer.locator("h2")).toHaveCSS("font-size", "16.8px");
  await expect(answer.locator(".answer-text")).toHaveCSS("font-size", "16px");
  await expect(answer.getByRole("button", { name: s.reportButton })).toBeVisible();
  await expect(page.getByRole("navigation", { name: s.sessionQuestions })).toBeVisible();
  await expect(page.getByRole("button", { name: s.changeAccessCode })).toBeVisible();
});
