// 手機的登入與「使用邀請碼體驗」對齊設計稿（#355，畫板 docs/design/v1/boards/K-Mobile.dc.html 第 1、2 張）：390×844 時登入前沒有頂端列、
// 底部分頁列與身分徽章（展示模式也一樣），登入後照舊。帳號登入：上方 330px 的主視覺左上是產品名稱與「虛構資料」，表單不包卡片；
// 帳號單選列、虛線的密碼欄、「登入」與「使用邀請碼體驗」。使用邀請碼體驗：沒有主視覺，「ACCESS」與標題、mono 的邀請碼欄，
// 「開始使用」與「← 改用帳號登入」在下方。輸入框與按鈕高 52px、文字按鈕 44px，沒有橫向捲動；英文介面不破版。
// 截圖附在測試報告（CI 的 E2E artifact）。/api/ask 一律是假的回應。
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { ACCESS_CODE, blockModelDownload, chooseAccount, identityBadge, s, signInPanel } from "./support/app";
import { access, client, language } from "./support/client";
import { routeFakeAsk } from "./support/fake-ask";

test.use({ viewport: { width: 390, height: 844 } });

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (el: Locator) => (await el.boundingBox())!;
const panel = (page: Page) => page.locator(".entry__panel");
const hero = (page: Page) => page.locator("main.entry .hero");
const brand = (page: Page) => page.locator("main.entry .entry-brand");
const codeForm = (page: Page) => page.locator("form.access-code");
// 登入前不該出現的導覽：手機的頂端列、分頁列、身分徽章，以及其他寬度的導覽
const navigation = (page: Page) => page.locator(":is(.mobile-topbar, .mobile-tabbar, .identity-badge, .sidebar, .nav-rail, .entry-bar)");
// 看得到的輸入框與按鈕（文字按鈕另外量 44px；單選鈕的觸控範圍是整列）
const FORM_CONTROLS = 'input:not([type="checkbox"], [type="radio"]), button:not(.link)';

const tokenColor = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--color-${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);

async function heights(scope: Locator, selector: string): Promise<number[]> {
  return scope.locator(selector).evaluateAll((els) => els.filter((el) => el.checkVisibility()).map((el) => el.getBoundingClientRect().height));
}

async function expectControlHeights(page: Page): Promise<void> {
  for (const h of await heights(panel(page), FORM_CONTROLS)) expect(h).toBeGreaterThanOrEqual(52);
  for (const h of await heights(panel(page), "button.link")) expect(h).toBeGreaterThanOrEqual(44);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function open(page: Page, path = "/"): Promise<void> {
  await blockModelDownload(page);
  await routeFakeAsk(page);
  await page.goto(path);
}

test("帳號登入：沒有頂端列與分頁列；主視覺 330px，左上是產品名稱與「虛構資料」；表單不包卡片，單選列與虛線密碼欄照畫板", async ({ page }, testInfo) => {
  await open(page);
  const form = signInPanel(page);
  await expect(form).toBeVisible();
  await expect(navigation(page)).toHaveCount(0);

  // 主視覺在上、高 330px，面板接在下方；左上的標示在主視覺範圍內，「展示用權限」登入前不顯示（與現行相同）
  const heroBox = await box(hero(page));
  expect(heroBox.y).toBeCloseTo(0, 0);
  expect(heroBox.height).toBeCloseTo(330, 0);
  expect((await box(panel(page))).y).toBeGreaterThanOrEqual(heroBox.y + heroBox.height - 1);
  await expect(brand(page).getByRole("heading", { level: 1 })).toContainText(s.productName);
  await expect(brand(page).getByText(s.fictionalData, { exact: true })).toBeVisible();
  await expect(page.getByText(s.demoPermissions, { exact: true })).toHaveCount(0);
  const brandBox = await box(brand(page));
  expect(brandBox.y + brandBox.height).toBeLessThanOrEqual(heroBox.y + heroBox.height);

  // 面板是 surface 底；表單本身不是卡片（沒有框線與底色）；不顯示「SIGN IN」與「或」
  await expect(panel(page)).toHaveCSS("background-color", await tokenColor(page, "surface"));
  await expect(form).toHaveCSS("border-top-width", "0px");
  await expect(form).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(form.getByRole("heading", { level: 2, name: s.signInTitle })).toHaveCSS("font-size", "22px");
  await expect(form.getByText(s.signInEyebrow, { exact: true })).toBeHidden();
  await expect(form.getByText(s.signInOr, { exact: true })).toBeHidden();

  // 帳號單選列：每個角色一列、高 46px 以上、mono 的展示帳號，選中的列是 primary 框
  const radios = form.getByRole("radio");
  await expect(radios).toHaveCount(access.roles.length);
  const cards = form.locator(".account-card");
  for (const h of await heights(form, ".account-card")) expect(h).toBeGreaterThanOrEqual(46);
  await expect(cards.first().locator(".account-card__account")).toHaveCSS("font-family", /Mono/);
  await expect(cards.filter({ has: page.locator("input:checked") })).toHaveCSS("border-top-color", await tokenColor(page, "primary"));

  // 密碼欄：停用、虛線框，「展示版不需要密碼」是 placeholder；仍以「密碼」為名稱
  const password = form.getByLabel(s.signInPassword);
  await expect(password).toBeDisabled();
  await expect(password).toHaveAttribute("placeholder", s.signInNoPassword);
  await expect(password).toHaveCSS("border-top-style", "dashed");

  // 「登入」在「使用邀請碼體驗」上方，兩者都是 52px
  const submit = form.getByRole("button", { name: s.signInSubmit, exact: true });
  const alt = form.getByRole("button", { name: s.signInWithCode });
  expect((await box(alt)).y).toBeGreaterThan((await box(submit)).y);
  await expectControlHeights(page);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "entry-mobile-account");
});

test("使用邀請碼體驗：沒有主視覺與導覽；ACCESS、標題 24px、mono 的邀請碼欄；「開始使用」與「改用帳號登入」在下方", async ({ page }, testInfo) => {
  await open(page);
  await page.getByRole("button", { name: s.signInWithCode }).click();
  const form = codeForm(page);
  const title = form.getByRole("heading", { level: 2, name: s.accessCodeTitle });
  await expect(title).toBeFocused();
  await expect(navigation(page)).toHaveCount(0);
  await expect(hero(page)).toBeHidden();
  await expect(brand(page)).toBeHidden();

  await expect(form.getByText(s.accessCodeEyebrow, { exact: true })).toBeVisible();
  await expect(title).toHaveCSS("font-size", "24px");
  const input = form.getByLabel(s.accessCodeLabel);
  await expect(input).toHaveCSS("font-family", /Mono/);
  await expect(input).toHaveCSS("font-size", "17px");

  // 「開始使用」在邀請碼欄下方、「改用帳號登入」在最下方，都在第一個畫面內
  const submit = form.getByRole("button", { name: s.accessCodeSubmit });
  const back = page.getByRole("button", { name: s.signInBack });
  const inputBox = await box(input);
  const submitBox = await box(submit);
  const backBox = await box(back);
  expect(submitBox.y).toBeGreaterThan(inputBox.y + inputBox.height);
  expect(backBox.y).toBeGreaterThanOrEqual(submitBox.y + submitBox.height);
  expect(backBox.y + backBox.height).toBeLessThanOrEqual(844);
  expect(backBox.width).toBeGreaterThanOrEqual(44);
  await expectControlHeights(page);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "entry-mobile-code");

  // 改用帳號登入：主視覺回來，焦點在帳號登入的標題
  await back.click();
  await expect(signInPanel(page).getByRole("heading", { level: 2, name: s.signInTitle })).toBeFocused();
  await expect(hero(page)).toBeVisible();
});

test("登入後照舊：帳號登入固定身分、以邀請碼體驗可以切換身分，兩者都有分頁列與身分徽章", async ({ page }) => {
  await open(page);
  const role = access.roles[access.roles.length - 1];
  const form = signInPanel(page);
  await chooseAccount(form, role.id);
  const code = form.getByLabel(s.accessCodeLabel);
  // 沒有公開碼的部署：帳號登入也要輸入邀請碼
  if (await code.isVisible()) await code.fill(ACCESS_CODE);
  await form.getByRole("button", { name: s.signInSubmit, exact: true }).click();
  await expect(page.locator(".mobile-tabbar")).toBeVisible();
  await expect(identityBadge(page)).toHaveText(role.label[language]);
  await expect(page.locator(".mobile-topbar").getByText(s.demoPermissions)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: s.signInWithCode }).click();
  await codeForm(page).getByLabel(s.accessCodeLabel).fill(ACCESS_CODE);
  await codeForm(page).getByRole("button", { name: s.accessCodeSubmit }).click();
  await expect(page.locator(".mobile-tabbar")).toBeVisible();
  await expect(identityBadge(page)).toBeVisible();
});

test("展示模式的登入頁也沒有導覽，只有邀請碼", async ({ page }) => {
  await open(page, "/?mode=presentation");
  await expect(codeForm(page)).toBeVisible();
  await expect(page.locator(":is(.mobile-topbar, .mobile-tabbar, .mobile-segmented, .presentation-bar)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: s.signInBack })).toHaveCount(0);
  await expectControlHeights(page);
  expect(await noHorizontalScroll(page)).toBe(true);
});

// 手機登入前沒有語言選單（與現行相同），所以在桌機的頂端列切成英文後再縮到手機寬度
test("英文介面：帳號登入與使用邀請碼體驗不破版", async ({ page }, testInfo) => {
  test.skip(!client.languages.includes("en"), "client.json 的 languages 沒有 en");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.getByRole("banner").getByLabel(s.language).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(navigation(page)).toHaveCount(0);
  await expect(hero(page)).toBeVisible();
  await expectControlHeights(page);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "entry-mobile-account-en");

  await page.locator(".sign-in__alt").click();
  await expect(codeForm(page)).toBeVisible();
  await expectControlHeights(page);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "entry-mobile-code-en");
});
