// 手機的首頁（#356，畫板 docs/design/v1/boards/K-Mobile.dc.html 的首頁 · 一般員工、首頁 · 主管）：390×844 時提問框是單行輸入列、
// 常見問題在下方一行；主管的數字卡與「開始審核」在最上；不顯示「看得到的範圍」（在身分與語言面板，#255）；
// 觸控目標至少 44px、沒有橫向捲動，英文介面不破版。截圖附在測試報告（CI 的 E2E artifact）。/api/ask 一律是假的回應。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoView, openApp, s, switchIdentity, switchLanguage, tab } from "./support/app";
import { client, NO_NON_REVIEWER, NO_REVIEWER, nonReviewer, reviewer } from "./support/client";
import { routeFakeAsk } from "./support/fake-ask";

test.use({ viewport: { width: 390, height: 844 } });

const home = (page: Page) => page.locator(".home--phone");
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// 看得到的按鈕都至少 44×44px（橫向滑動的常見問題只看高度）
async function expectTouchTargets(buttons: Locator) {
  for (const button of await buttons.all()) {
    if (!(await button.isVisible())) continue;
    const b = (await button.boundingBox())!;
    expect(b.height, await button.innerText()).toBeGreaterThanOrEqual(44);
  }
}

test.beforeEach(async ({ page }) => {
  await routeFakeAsk(page);
  await openApp(page);
});

for (const who of ["一般員工", "主管"] as const) {
  test(`${who}：單行提問框、常見問題在下方、不顯示可見範圍；觸控目標至少 44px、沒有橫向捲動`, async ({ page }, testInfo) => {
    const role = who === "主管" ? reviewer : nonReviewer;
    test.skip(role === undefined, who === "主管" ? NO_REVIEWER : NO_NON_REVIEWER);
    await switchIdentity(page, role!.id);
    // openApp() 登入後停在問答頁：切到首頁再檢查
    expect(await gotoView(page, "home")).toBe(true);
    await expect(tab(page, s.tabHome)).toHaveAttribute("aria-current", "page");
    await expect(home(page)).toBeVisible();
    await expect(home(page).getByText(s.loading)).toHaveCount(0);
    await expect(page.locator(".home__scope")).toHaveCount(0);

    // 提問框：單行的 input（不是 textarea），「提問」在框內
    const input = page.getByRole("textbox", { name: s.questionLabel });
    expect(await input.evaluate((el) => el.tagName)).toBe("INPUT");
    const form = page.locator(".free-question--compact");
    const ask = page.getByRole("button", { name: s.askButton, exact: true });
    const formBox = (await form.boundingBox())!;
    const askBox = (await ask.boundingBox())!;
    expect(askBox.x + askBox.width).toBeLessThanOrEqual(formBox.x + formBox.width);
    expect(askBox.y).toBeGreaterThanOrEqual(formBox.y);
    const presets = page.getByRole("group", { name: s.home.commonQuestions });
    if ((await presets.count()) > 0) {
      const presetsBox = (await presets.boundingBox())!;
      expect(presetsBox.y).toBeGreaterThan(formBox.y);
      expect(presetsBox.x).toBeCloseTo(formBox.x, 0);
    }
    // 提問框和其他區塊同寬：左緣和「最近新增的文件」的標題相同（左右留白 16px），不貼齊畫面
    const documentsTitle = page.locator("#home-documents");
    await expect(documentsTitle).toBeVisible();
    expect(formBox.x).toBeCloseTo((await documentsTitle.boundingBox())!.x, 0);
    expect(formBox.x).toBeGreaterThanOrEqual(16);
    expect(formBox.x + formBox.width).toBeLessThanOrEqual(390 - 16);

    if (who === "主管") {
      const waiting = page.getByRole("region", { name: s.home.waitingTitle });
      const start = waiting.getByRole("button", { name: s.home.startReview });
      // 有待審時是兩張數字卡與「開始審核」，在提問框上方；沒有時是空狀態
      await expect(start.or(waiting.getByText(s.home.waitingNone))).toBeVisible();
      if ((await start.count()) > 0) {
        await expect(waiting.locator(".home__stat")).toHaveCount(2);
        expect((await start.boundingBox())!.y).toBeLessThan(formBox.y);
      }
    } else {
      await expect(page.getByRole("region", { name: s.home.updatesTitle })).toBeVisible();
      await expect(page.getByRole("region", { name: s.home.waitingTitle })).toHaveCount(0);
    }

    await expectTouchTargets(home(page).getByRole("button"));
    expect(await noHorizontalScroll(page)).toBe(true);
    await testInfo.attach(`home-${role!.id}-390px.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    // 提問送到問答頁；回到首頁，問過的問題整行是「再問一次」
    const question = "E2E mobile home question";
    await input.fill(question);
    await expect(ask).toBeEnabled();
    await input.press("Enter");
    await expect(tab(page, s.tabQa)).toHaveAttribute("aria-current", "page");
    await gotoView(page, "home");
    const again = page.getByRole("button", { name: `${s.home.askAgain}${s.colon}${question}` });
    await expect(again).toBeVisible();
    expect((await again.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
}

for (const who of ["一般員工", "主管"] as const) {
  test(`英文介面：${who}的首頁不破版`, async ({ page }, testInfo) => {
    const role = who === "主管" ? reviewer : nonReviewer;
    test.skip(!client.languages.includes("en"), "client.json 的 languages 沒有 en");
    test.skip(role === undefined, who === "主管" ? NO_REVIEWER : NO_NON_REVIEWER);
    await switchIdentity(page, role!.id);
    expect(await gotoView(page, "home")).toBe(true);
    await switchLanguage(page, "en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(home(page)).toBeVisible();
    await expect(home(page).locator("p.muted")).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    await testInfo.attach(`home-${role!.id}-390px-en.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
}
