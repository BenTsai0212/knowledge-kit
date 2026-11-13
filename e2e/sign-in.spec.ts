// 登入頁的兩條路（#287，docs/design.md「日常工具」的「登入」）：登入頁沒有身分選單；帳號登入（展示）身分固定、不能切換；使用邀請碼體驗與展示模式進入後可以切換。
// 這個 build 沒有公開碼（線上 demo 的帳號登入見 demo.spec.ts），所以帳號登入也要輸入邀請碼。/api/ask 一律是假的回應。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ACCESS_CODE, blockModelDownload, chooseAccount, identityBadge, identitySegments, identitySheet, language, openApp, presetQuestions, s, signInPanel, switchIdentity, userCard } from "./support/app";
import { access, client } from "./support/client";
import { routeFakeAsk } from "./support/fake-ask";
import { demoAccount } from "../app/src/ui/sign-in";

// 身分選單：桌機是左側欄的使用者卡（#330），登入頁沒有
const identityMenu = (page: Page) => identityBadge(page);

test("帳號登入：密碼欄停用、不是表單；登入後沒有身分選單，帳號與邀請碼不保存，/api/ask 仍帶邀請碼；登出回到登入頁", async ({ page }) => {
  const question = presetQuestions[0];
  await blockModelDownload(page);
  await routeFakeAsk(page);
  await page.goto("/");

  const panel = signInPanel(page);
  // 登入頁沒有身分選單（語言選單保留）：身分由登入決定（#287 PR 1 審查）
  await expect(identityMenu(page)).toHaveCount(0);
  await expect(page.getByRole("banner").getByLabel(s.language)).toBeVisible();
  await expect(panel.locator("form")).toHaveCount(0);
  const password = panel.getByLabel(s.signInPassword);
  await expect(password).toBeDisabled();
  await expect(password).toHaveAttribute("autocomplete", "off");
  await expect(password).toHaveAttribute("placeholder", s.signInNoPassword);

  const login = panel.getByRole("button", { name: s.signInSubmit, exact: true });
  await chooseAccount(panel, question.role);
  // 沒有公開碼：沒填邀請碼不能登入
  await expect(login).toBeDisabled();
  await panel.getByLabel(s.accessCodeLabel).fill(ACCESS_CODE);
  await login.click();
  await expect(page.getByRole("button", { name: question.text, exact: true })).toBeEnabled();

  // 身分是登入的帳號：使用者卡顯示帳號與角色，選單只有語言與「登出」，不能切換身分（#330 決定 2）
  const role = access.roles.find((r) => r.id === question.role)!;
  await expect(userCard(page).locator(".user-card__name")).toHaveText(demoAccount(question.role));
  await expect(userCard(page).locator(".user-card__role")).toHaveText(role.label[language]);
  await identityMenu(page).click();
  await expect(identitySheet(page)).toBeVisible();
  await expect(identitySheet(page).getByRole("radio")).toHaveCount(0);
  await expect(identitySheet(page).getByRole("group", { name: s.language })).toBeVisible();
  await expect(identitySheet(page).getByRole("button", { name: s.signOut })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(identitySheet(page)).toBeHidden();
  // 帳號與邀請碼都不寫入瀏覽器的儲存：重新整理後回到登入頁
  const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
  expect(stored).not.toContain(ACCESS_CODE);
  expect(stored).not.toContain("@example.test");

  const request = page.waitForRequest("**/api/ask");
  await page.getByRole("button", { name: question.text, exact: true }).click();
  expect((await request).headers()["x-access-code"]).toBe(ACCESS_CODE);

  await userCard(page).getByRole("button", { name: s.signOut }).click();
  await expect(signInPanel(page)).toBeVisible();
  await expect(identityMenu(page)).toHaveCount(0);
});

test("使用邀請碼體驗：進入後才出現身分選單，可以切換到每個身分", async ({ page }) => {
  await blockModelDownload(page);
  await page.goto("/");
  await page.getByRole("button", { name: s.signInWithCode }).click();
  // 輸入邀請碼的畫面也還是登入頁：沒有身分選單
  await expect(page.getByLabel(s.accessCodeLabel)).toBeVisible();
  await expect(identityMenu(page)).toHaveCount(0);
  await openApp(page);
  for (const role of access.roles) {
    await switchIdentity(page, role.id);
    await expect(userCard(page).locator(".user-card__name")).toHaveText(role.label[language]);
  }
});

test("展示模式：登入頁只有邀請碼，進入後是問答且可以切換身分", async ({ page }) => {
  await blockModelDownload(page);
  await routeFakeAsk(page);
  await page.goto("/?mode=presentation");
  await expect(signInPanel(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: s.signInWithCode })).toHaveCount(0);
  await expect(identityMenu(page)).toHaveCount(0);
  await page.getByLabel(s.accessCodeLabel).fill(ACCESS_CODE);
  await page.getByRole("button", { name: s.accessCodeSubmit }).click();
  await expect(page.getByRole("button", { name: presetQuestions[0].text, exact: true })).toBeEnabled();
  const other = access.roles.at(-1)!;
  // 展示模式的身分是頂端列的分段切換（#260）
  await switchIdentity(page, other.id);
  await expect(identitySegments(page).getByRole("radio", { name: other.label[language], exact: true })).toBeChecked();
});

// 桌機的登入頁（#334，畫板 K-Login）：沒有左側導覽，頂端列＋左側主視覺＋右側寬 380～520px 的登入面板
test.describe("桌機（1440×900）", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const entryPanel = (page: Page) => page.locator(".entry__panel");
  const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? "");
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  // 輸入框滿寬：與同一個面板中滿寬的主要按鈕同寬、左緣對齊（標籤在上，不與輸入框同列）
  async function expectFullWidth(input: Locator, button: Locator): Promise<void> {
    const [field, full] = [await box(input), await box(button)];
    expect(field.x).toBeCloseTo(full.x, 0);
    expect(field.width).toBeCloseTo(full.width, 0);
  }

  async function expectDesktopEntry(page: Page): Promise<void> {
    await expect(page.locator(":is(.sidebar, .nav-rail, .mobile-topbar)")).toHaveCount(0);
    // 切換語言後標籤也換了，所以以元素找頂端列的語言選單
    const languageSelect = page.getByRole("banner").locator("select");
    await expect(languageSelect).toBeVisible();
    // 右側內距留給自繪的下拉箭頭，選項文字不壓到箭頭
    expect(await languageSelect.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight))).toBeGreaterThanOrEqual(28);
    const panel = (await entryPanel(page).boundingBox())!;
    expect(panel.width).toBeGreaterThanOrEqual(380);
    expect(panel.width).toBeLessThanOrEqual(520);
    expect(panel.x + panel.width).toBeCloseTo(1440, 0);
    // 主視覺佔滿面板左側
    const hero = (await page.locator("main.entry .hero").boundingBox())!;
    expect(hero.x).toBeCloseTo(0, 0);
    expect(hero.x + hero.width).toBeCloseTo(panel.x, 0);
    expect(await noHorizontalScroll(page)).toBe(true);
  }

  test("帳號登入：沒有左側欄、面板貼齊右緣；帳號是單選卡（方向鍵可切換）、「登入」高 52px；英文不破版", async ({ page }) => {
    await blockModelDownload(page);
    await page.goto("/");
    const panel = signInPanel(page);
    await expect(panel).toBeVisible();
    await expectDesktopEntry(page);
    await expect(page.getByRole("banner").getByRole("heading", { level: 1 })).toContainText(client.displayName[language]);

    const group = panel.getByRole("radiogroup", { name: s.signInAccount });
    const radios = group.getByRole("radio");
    await expect(radios).toHaveCount(access.roles.length);
    expect(access.roles.length).toBeGreaterThanOrEqual(3);
    for (const [index, role] of access.roles.entries()) await expect(radios.nth(index)).toHaveAccessibleName(new RegExp(role.id));
    await chooseAccount(panel, access.roles[0].id);
    await radios.nth(0).focus();
    await page.keyboard.press("ArrowDown");
    await expect(radios.nth(1)).toBeChecked();
    await expect(radios.nth(1)).toBeFocused();
    // 每張卡一列：左邊圓點、右邊帳號與角色，高 52px（± 2）
    const cards = panel.locator(".account-card");
    await expect(cards).toHaveCount(access.roles.length);
    for (let i = 0; i < access.roles.length; i++) {
      const [card, radio, text] = [await box(cards.nth(i)), await box(radios.nth(i)), await box(cards.nth(i).locator(".account-card__text"))];
      expect(Math.abs(card.height - 52)).toBeLessThanOrEqual(2);
      expect(text.x).toBeGreaterThan(radio.x + radio.width);
      expect(text.y).toBeLessThan(radio.y + radio.height);
    }

    const login = panel.getByRole("button", { name: s.signInSubmit, exact: true });
    expect((await login.boundingBox())!.height).toBeCloseTo(52, 0);
    // 沒有公開碼的部署：邀請碼欄在密碼欄下方
    const password = (await panel.getByLabel(s.signInPassword).boundingBox())!;
    const code = (await panel.getByLabel(s.accessCodeLabel).boundingBox())!;
    expect(code.y).toBeGreaterThan(password.y);
    await expectFullWidth(panel.getByLabel(s.accessCodeLabel), login);

    // 英文版面（#288）：客戶有英文時切換後也不破版
    if (client.languages.includes("en")) {
      await page.getByRole("banner").getByLabel(s.language).selectOption("en");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expectDesktopEntry(page);
    }
  });

  test("使用邀請碼體驗與改用帳號登入在同一個面板切換，焦點移到新標題", async ({ page }) => {
    await blockModelDownload(page);
    await page.goto("/");
    await page.getByRole("button", { name: s.signInWithCode }).click();
    await expect(page.getByLabel(s.accessCodeLabel)).toBeVisible();
    await expect.poll(() => focusedText(page)).toBe(s.accessCodeTitle);
    expect((await page.getByLabel(s.accessCodeLabel).boundingBox())!.height).toBeCloseTo(52, 0);
    expect((await page.getByRole("button", { name: s.accessCodeSubmit }).boundingBox())!.height).toBeCloseTo(52, 0);
    await expectFullWidth(page.getByLabel(s.accessCodeLabel), page.getByRole("button", { name: s.accessCodeSubmit }));
    await expectDesktopEntry(page);

    await page.getByRole("button", { name: s.signInBack }).click();
    await expect(signInPanel(page)).toBeVisible();
    await expect.poll(() => focusedText(page)).toBe(s.signInTitle);
  });

  test("展示模式：只有邀請碼，也是沒有左側欄的新面板", async ({ page }) => {
    await blockModelDownload(page);
    await page.goto("/?mode=presentation");
    await expect(page.getByLabel(s.accessCodeLabel)).toBeVisible();
    await expect(signInPanel(page)).toHaveCount(0);
    await expectDesktopEntry(page);
  });
});
