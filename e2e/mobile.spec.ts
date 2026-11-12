// 手機的共同結構（#255，docs/design.md「手機與平板」）：390×844 時是頂端列（60px）＋底部分頁列（72px），不顯示左側導覽；
// 分頁列依身分分配（一般員工 5 頁，主管把時間軸、待審、評測台收進「更多」），展示模式改用分段切換；底部面板的開關與焦點。
// 身分與語言面板的內容（單選卡與說明）在 #255 的下一個 PR。往下拖曳的手感與 safe area 由人在實機確認。/api/ask 一律是假的回應。
import { expect, test, type Page } from "@playwright/test";
import { EVALS_PATH, identityBadge, identitySheet, openApp, s, switchIdentity } from "./support/app";
import { access, client, language, NO_NON_REVIEWER, NO_REVIEWER, nonReviewer, reviewer } from "./support/client";

test.use({ viewport: { width: 390, height: 844 } });

const tabBar = (page: Page) => page.locator(".mobile-tabbar");
const tabViews = (page: Page) => tabBar(page).locator("button").evaluateAll((buttons) => buttons.map((b) => b.getAttribute("data-view")));
const moreSheet = (page: Page) => page.locator("dialog.more-sheet");
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const focusInside = (page: Page, selector: string) => page.evaluate((sel) => document.activeElement?.closest(sel) != null, selector);

test("頂端列 60px：客戶名稱、身分徽章、「虛構資料」「展示用權限」；不顯示左側導覽，整頁沒有橫向捲動", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  const top = page.getByRole("banner");
  expect((await top.locator(".mobile-topbar__row").boundingBox())!.height).toBeCloseTo(60, 0);
  await expect(top.getByRole("heading", { level: 1 })).toContainText(client.displayName[language]);
  await expect(top.getByText(s.fictionalData)).toBeVisible();
  await expect(top.getByText(s.demoPermissions)).toBeVisible();
  await expect(identityBadge(page)).toHaveText(access.roles[0].label[language]);
  expect((await identityBadge(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("一般員工：分頁列 72px 在視窗底部，首頁、問答、圖譜、時間軸、上傳，沒有「更多」；按了切換頁面", async ({ page }) => {
  test.skip(nonReviewer === undefined, NO_NON_REVIEWER);
  await openApp(page);
  await switchIdentity(page, nonReviewer!.id);
  const bar = (await tabBar(page).boundingBox())!;
  expect(bar.height).toBeCloseTo(72, 0);
  expect(bar.y + bar.height).toBeCloseTo(844, 0);
  expect(await tabViews(page)).toEqual(["home", "qa", "graph", "timeline", "upload"]);
  for (const box of await tabBar(page).locator("button").evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);

  await tabBar(page).locator('[data-view="timeline"]').click();
  await expect(tabBar(page).locator('[data-view="timeline"]')).toHaveAttribute("aria-current", "page");
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("主管：首頁、問答、圖譜、上傳、更多；「更多」只列時間軸與待審（tools=evals 時加評測台），選了之後面板關閉", async ({ page }) => {
  test.skip(reviewer === undefined, NO_REVIEWER);
  await openApp(page, EVALS_PATH);
  await switchIdentity(page, reviewer!.id);
  expect(await tabViews(page)).toEqual(["home", "qa", "graph", "upload", "more"]);

  const more = tabBar(page).locator('[data-view="more"]');
  await more.click();
  await expect(moreSheet(page)).toBeVisible();
  await expect(moreSheet(page).getByRole("heading", { name: s.navMore })).toBeVisible();
  const items = moreSheet(page).locator(".more-list button");
  expect(await items.evaluateAll((bs) => bs.map((b) => b.getAttribute("data-view")))).toEqual(["timeline", "review", "evals"]);
  expect(await focusInside(page, "dialog.more-sheet")).toBe(true);

  await moreSheet(page).locator('[data-view="review"]').click();
  await expect(moreSheet(page)).toBeHidden();
  await expect(page.locator(".review-page")).toBeVisible();
  // 目前的頁面收在「更多」裡時，「更多」標為目前的頁籤；關閉後焦點回到「更多」
  await expect(more).toHaveAttribute("aria-current", "page");
  await expect(more).toBeFocused();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("底部面板：從身分徽章打開，焦點移入；關閉按鈕、Esc、往下拖都會關閉，焦點回到徽章", async ({ page }) => {
  await openApp(page);
  const sheet = identitySheet(page);

  await identityBadge(page).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: s.identityAndLanguage })).toBeVisible();
  expect(await focusInside(page, "dialog.identity-sheet")).toBe(true);
  expect(await sheet.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("24px");
  const handle = (await sheet.locator(".bottom-sheet__handle").boundingBox())!;
  expect([handle.width, handle.height]).toEqual([40, 5]);
  await sheet.getByRole("button", { name: s.dialogClose, exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(identityBadge(page)).toBeFocused();

  await identityBadge(page).click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(identityBadge(page)).toBeFocused();

  // 從把手往下拖超過門檻
  await identityBadge(page).click();
  await expect(sheet).toBeVisible();
  const grip = (await sheet.locator(".bottom-sheet__handle").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect(sheet).toBeHidden();
  await expect(identityBadge(page)).toBeFocused();
});

test("在面板中切換身分：徽章換成新的身分", async ({ page }) => {
  const other = access.roles.find((r) => r.id !== access.roles[0].id);
  test.skip(other === undefined, "access.json 只有一個身分");
  await openApp(page);
  await switchIdentity(page, other!.id);
  await expect(identityBadge(page)).toHaveText(other!.label[language]);
});

test("展示模式：沒有分頁列，頂端列下方是問答與圖譜的分段切換", async ({ page }) => {
  await openApp(page, "/?mode=presentation");
  await expect(tabBar(page)).toHaveCount(0);
  const segmented = page.locator(".mobile-segmented");
  await expect(segmented.getByRole("button")).toHaveText([s.tabQa, s.tabGraph]);
  await expect(segmented.getByRole("button", { name: s.tabQa })).toHaveAttribute("aria-current", "page");
  await segmented.getByRole("button", { name: s.tabGraph }).click();
  await expect(segmented.getByRole("button", { name: s.tabGraph })).toHaveAttribute("aria-current", "page");
  expect((await segmented.getByRole("button").first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("斷點：600px 是手機，601px 起是左側導覽", async ({ page }) => {
  await openApp(page);
  await page.setViewportSize({ width: 600, height: 844 });
  await expect(tabBar(page)).toBeVisible();
  await page.setViewportSize({ width: 601, height: 844 });
  await expect(tabBar(page)).toHaveCount(0);
  await expect(page.locator(".sidebar")).toBeVisible();
});
