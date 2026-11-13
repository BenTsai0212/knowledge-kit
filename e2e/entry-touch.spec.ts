// 入口（手機）與觸控目標（#255 PR 4，docs/design.md「手機與平板」「入口（手機）」）：
// 手機（390×844）的入口主視覺在上、高 330px，前景節點數減半、遠景不模糊；輸入框與按鈕高 52px，文字連結 44px。
// 平板（820×1180）的登入頁沿用手機版（主視覺在上、表單在下），主視覺維持完整的節點數與景深。
// 兩種寬度的導覽與面板中，按鈕與欄位高至少 44px，整頁沒有橫向捲動。safe area 由人在實機確認。/api/ask 一律是假的回應。
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { EntitiesFile } from "../app/src/dataset/types";
import { HERO_COUNTS, HERO_PHONE_FRONT } from "../app/src/ui/entry-hero";
import { blockModelDownload, EVALS_PATH, identityBadge, identitySheet, openApp, s, signInPanel, switchIdentity } from "./support/app";
import { NO_REVIEWER, readClientJson, reviewer } from "./support/client";

const entityCount = readClientJson<EntitiesFile>("data/entities.json").entities.length;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const hero = (page: Page) => page.locator("main.entry .hero");
const entryPanel = (page: Page) => page.locator(".entry__panel");
// 畫面上看得到的按鈕與欄位（核取方塊與單選鈕的觸控範圍是外層的整張卡，不在此列）
const CONTROLS = 'button, select, input:not([type="checkbox"], [type="radio"])';
const FORM_CONTROLS = 'select, input:not([type="checkbox"], [type="radio"]), button:not(.link)';

// 高度不到 min 的控制項，回傳文字或標籤方便看出是哪一個
async function shorterThan(scope: Locator, selector: string, min: number): Promise<string[]> {
  return scope.locator(selector).evaluateAll(
    (els, limit) =>
      els
        // 只給報讀器的（visually-hidden，1×1px）不算
        .filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 1)
        .filter((el) => el.getBoundingClientRect().height < limit)
        .map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""} ${el.getBoundingClientRect().height}px`),
    min,
  );
}

// 主視覺在上（高 330px）、面板在下
async function expectHeroOnTop(page: Page): Promise<void> {
  await expect(hero(page).locator(".hero__scene")).toBeAttached();
  const top = (await hero(page).boundingBox())!;
  const panel = (await entryPanel(page).boundingBox())!;
  expect(top.height).toBeCloseTo(330, 0);
  expect(panel.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
}

test.describe("手機（390×844）", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("入口：主視覺在上、高 330px，前景節點數減半、遠景不模糊；輸入框與按鈕高 52px，沒有橫向捲動", async ({ page }) => {
    await blockModelDownload(page);
    await page.goto("/");
    await expect(signInPanel(page)).toBeVisible();
    await expectHeroOnTop(page);
    await expect(hero(page)).toHaveClass(/\bhero--phone\b/);
    await expect(hero(page).locator(".hero__float")).toHaveCount(Math.min(HERO_PHONE_FRONT, entityCount));
    await expect(hero(page).locator(".hero__layer--far")).toHaveCSS("filter", "none");
    expect(await shorterThan(entryPanel(page), FORM_CONTROLS, 52)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);

    // 使用邀請碼體驗：輸入框與送出 52px，「回到帳號登入」的文字連結 44px
    await page.getByRole("button", { name: s.signInWithCode }).click();
    await expect(page.getByLabel(s.accessCodeLabel)).toBeVisible();
    expect(await shorterThan(entryPanel(page), FORM_CONTROLS, 52)).toEqual([]);
    expect(await shorterThan(entryPanel(page), "button.link", 44)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("觸控目標：頂端列、分頁列、身分與語言面板的按鈕與欄位高至少 44px", async ({ page }) => {
    await openApp(page);
    expect(await shorterThan(page.locator(":is(.mobile-topbar, .mobile-tabbar)"), CONTROLS, 44)).toEqual([]);
    await identityBadge(page).click();
    await expect(identitySheet(page)).toBeVisible();
    expect(await shorterThan(identitySheet(page), CONTROLS, 44)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("觸控目標：主管的「更多」面板高至少 44px", async ({ page }) => {
    test.skip(reviewer === undefined, NO_REVIEWER);
    await openApp(page, EVALS_PATH);
    await switchIdentity(page, reviewer!.id);
    await page.locator('.mobile-tabbar [data-view="more"]').click();
    const more = page.locator("dialog.more-sheet");
    await expect(more).toBeVisible();
    expect(await shorterThan(more, CONTROLS, 44)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe("平板（820×1180）", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("入口：沿用手機版，主視覺在上、高 330px，維持完整的前景與景深；輸入框與按鈕高 52px，沒有橫向捲動", async ({ page }) => {
    await blockModelDownload(page);
    await page.goto("/");
    await expect(signInPanel(page)).toBeVisible();
    await expectHeroOnTop(page);
    await expect(hero(page)).not.toHaveClass(/\bhero--phone\b/);
    await expect(hero(page).locator(".hero__float")).toHaveCount(Math.min(HERO_COUNTS.front, entityCount));
    expect(await shorterThan(entryPanel(page), FORM_CONTROLS, 52)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("觸控目標：導覽列與身分與語言面板的按鈕與欄位高至少 44px", async ({ page }) => {
    await openApp(page);
    expect(await shorterThan(page.locator("nav.nav-rail"), CONTROLS, 44)).toEqual([]);
    await identityBadge(page).click();
    await expect(identitySheet(page)).toBeVisible();
    expect(await shorterThan(identitySheet(page), CONTROLS, 44)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});
