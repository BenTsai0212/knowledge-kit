// 平板（#255 PR 3，docs/design.md「平板」）：820×1180 時左側是 72px 的圖示導覽列（頁籤 60×56px、底部是身分的頭像），沒有左側導覽與手機的分頁列；
// 身分與語言、原文、圖譜的實體從右側滑出覆蓋（最寬 420px，實體 400px），Esc 與關閉按鈕關閉，開啟時焦點在面板內、關閉後回到觸發的元件。
// 每一步都檢查整頁沒有橫向捲動。向右滑的手感與 safe area 由人在實機確認。/api/ask 一律是假的回應。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { EVALS_PATH, identityBadge, identitySheet, openApp, openTab, presetQuestions, roleCard, s, switchIdentity } from "./support/app";
import { access, language, NO_REVIEWER, reviewer } from "./support/client";
import { waitForGraphIdle } from "./support/graph";

const WIDTH = 820;
test.use({ viewport: { width: WIDTH, height: 1180 } });

const rail = (page: Page) => page.locator("nav.nav-rail");
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const focusInside = (page: Page, selector: string) => page.evaluate((sel) => document.activeElement?.closest(sel) != null, selector);
// 等滑入的動畫結束再量位置
const settle = (el: Locator) => el.evaluate(async (node) => void (await Promise.all(node.getAnimations().map((a) => a.finished))));

// 滑出面板：貼齊視窗右緣、全高、寬度不超過 max
async function expectSlideOver(panel: Locator, max: number): Promise<void> {
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass(/\bslide-over\b/);
  await settle(panel);
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(max);
  expect(Math.abs(box.x + box.width - WIDTH)).toBeLessThan(2);
  expect(box.height).toBeCloseTo(1180, 0);
}

test("導覽列 72px：頁籤 60×56px、有 aria-label；不顯示左側導覽與分頁列，按了切換頁面", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(":is(.sidebar, .mobile-tabbar, .mobile-topbar)")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: s.views })).toHaveClass(/\bnav-rail\b/);
  expect((await rail(page).boundingBox())!.width).toBeCloseTo(72, 0);
  const tabs = rail(page).locator("button[data-view]");
  for (const box of await tabs.evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect()))) {
    expect(box.width).toBeCloseTo(60, 0);
    expect(box.height).toBeCloseTo(56, 0);
  }
  await rail(page).locator('[data-view="timeline"]').click();
  await expect(rail(page).locator('[data-view="timeline"]')).toHaveAttribute("aria-current", "page");
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("主管：所有頁籤都在導覽列（含待審，tools=evals 時加評測台），沒有「更多」", async ({ page }) => {
  test.skip(reviewer === undefined, NO_REVIEWER);
  await openApp(page, EVALS_PATH);
  await switchIdentity(page, reviewer!.id);
  const views = await rail(page).locator("button[data-view]").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-view")));
  expect(views).toEqual(["home", "qa", "graph", "timeline", "upload", "review", "evals"]);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("身分的頭像：身分與語言面板從右側滑出；Esc 關閉、焦點回到頭像；在面板中切換身分", async ({ page }) => {
  await openApp(page);
  const avatar = identityBadge(page);
  expect((await avatar.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await avatar.click();
  const sheet = identitySheet(page);
  await expectSlideOver(sheet, 420);
  expect(await focusInside(page, "dialog.identity-sheet")).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(avatar).toBeFocused();

  const other = access.roles.find((r) => r.id !== access.roles[0].id);
  test.skip(other === undefined, "access.json 只有一個身分");
  await avatar.click();
  await roleCard(sheet, other!.id).check();
  await sheet.getByRole("button", { name: s.dialogClose }).click();
  await expect(sheet).toBeHidden();
  await expect(avatar).toHaveAccessibleName(s.identityBadge.replace("{role}", other!.label[language]));
});

test("點引用標號：原文從右側滑出覆蓋、不常駐右欄；關閉按鈕關閉、焦點回到引用標號", async ({ page }) => {
  await openApp(page);
  const question = presetQuestions[0];
  await switchIdentity(page, question.role);
  await page.getByRole("button", { name: question.text, exact: true }).click();
  const answer = page.locator("section.answer").last();
  await expect(answer.getByText(s.answering)).toHaveCount(0);
  const citation = answer.locator("button.citation").first();
  await citation.click();

  const sheet = page.locator("dialog.source-sheet");
  await expectSlideOver(sheet, 420);
  await expect(page.locator("aside.source")).toHaveCount(0);
  await expect(page.locator("main.qa")).not.toHaveClass(/with-panel/);
  expect(await focusInside(page, "dialog.source-sheet")).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
  await sheet.getByRole("button", { name: s.dialogClose }).click();
  await expect(sheet).toBeHidden();
  await expect(citation).toBeFocused();
});

test("圖譜：點實體後實體面板從右側滑出（最寬 400px），Esc 關閉", async ({ page }) => {
  await openApp(page);
  await openTab(page, s.tabGraph);
  await waitForGraphIdle(page, ".graph-page .graph-canvas");
  const pick = page.locator(".graph-start button").first();
  await pick.click();
  const sheet = page.locator("dialog.entity-sheet");
  await expectSlideOver(sheet, 400);
  expect(await focusInside(page, "dialog.entity-sheet")).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  expect(await noHorizontalScroll(page)).toBe(true);
});
