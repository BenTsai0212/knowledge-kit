// 桌機的左側欄（#330，畫板 docs/design/v1/boards/K-Home.dc.html）：220px、44px 的頁面項目、選中是 text 底，
// 底部是「虛構資料 · 展示用權限」與使用者卡（邀請碼體驗與帳號登入兩種）。/api/ask 一律是假的回應。
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ACCESS_CODE,
  blockModelDownload,
  chooseAccount,
  identityBadge,
  identitySheet,
  language,
  openApp,
  presetQuestions,
  roleCard,
  s,
  signInPanel,
  switchIdentity,
  switchLanguage,
  userCard,
} from "./support/app";
import { access, client } from "./support/client";
import { routeFakeAsk } from "./support/fake-ask";
import { demoAccount } from "../app/src/ui/sign-in";

test.use({ viewport: { width: 1440, height: 900 } });

const sidebar = (page: Page) => page.locator("header.sidebar");
const items = (page: Page) => sidebar(page).getByRole("navigation", { name: s.views }).getByRole("button");
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// token 的計算值（rgb）：以暫時的元素套用 var(--color-<name>) 後讀取
const tokenColor = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--color-${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);

const scopeText = (id: string) => s.userCardScope.replace("{scope}", access.roles.find((r) => r.id === id)!.scope[language]);
const roleName = (id: string) => access.roles.find((r) => r.id === id)!.label[language];

async function expectFrame(page: Page): Promise<void> {
  const box = await sidebar(page).boundingBox();
  expect(box!.width).toBe(220);
  const current = items(page).and(page.locator('[aria-current="page"]'));
  await expect(current).toHaveCount(1);
  for (const item of await items(page).all()) expect((await item.boundingBox())!.height).toBe(44);
  await expect(current).toHaveCSS("background-color", await tokenColor(page, "text"));
  await expect(current).toHaveCSS("color", await tokenColor(page, "surface"));
  expect(await noHorizontalScroll(page)).toBe(true);
}

async function tabUntilFocused(page: Page, target: Locator, max = 20): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test("邀請碼體驗：寬度、項目與選中樣式照畫板；使用者卡是角色與「看得到：…」，打開身分與語言選單", async ({ page }) => {
  await openApp(page);
  const role = presetQuestions[0].role;
  await switchIdentity(page, role);
  await expectFrame(page);
  await expect(sidebar(page).getByRole("heading", { level: 1 })).toContainText(client.displayName[language]);
  await expect(sidebar(page).locator(".sidebar__labels")).toHaveText(`${s.fictionalData} · ${s.demoPermissions}`);
  // 「這次的問題」不在左側欄（#330 決定 3）
  await expect(page.getByRole("navigation", { name: s.sessionQuestions })).toHaveCount(0);

  const card = userCard(page);
  await expect(card.locator(".user-card__avatar")).toHaveText(Array.from(roleName(role))[0].toLocaleUpperCase());
  await expect(card.locator(".user-card__name")).toHaveText(roleName(role));
  await expect(card.getByText(scopeText(role), { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: s.signOut })).toHaveCount(0);

  // 選單：身分單選卡、語言分段切換、「更換邀請碼」；Esc 關閉後焦點回到使用者卡
  await identityBadge(page).click();
  const sheet = identitySheet(page);
  await expect(sheet).toBeVisible();
  await expect(roleCard(sheet, role)).toBeChecked();
  await expect(sheet.getByRole("group", { name: s.language })).toBeVisible();
  await expect(sheet.getByRole("button", { name: s.changeAccessCode })).toBeVisible();
  // 從左側欄旁出現，不蓋住左側欄
  expect((await sheet.boundingBox())!.x).toBeGreaterThanOrEqual(220);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(identityBadge(page)).toBeFocused();
});

test("鍵盤：頁面項目與使用者卡都能用 Tab 到達，aria-current 標示目前頁面", async ({ page }) => {
  await openApp(page);
  const first = items(page).first();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-current", "page");
  for (const item of (await items(page).all()).slice(1)) {
    await page.keyboard.press("Tab");
    await expect(item).toBeFocused();
  }
  await tabUntilFocused(page, identityBadge(page));
  await page.keyboard.press("Enter");
  await expect(identitySheet(page)).toBeVisible();
});

test("帳號登入：使用者卡是帳號、角色、「看得到：…」與「登出」；選單只有語言與「登出」", async ({ page }) => {
  const role = presetQuestions[0].role;
  await blockModelDownload(page);
  await routeFakeAsk(page);
  await page.goto("/");
  // 登入頁：沒有左側欄（#334，登入前是頂端列）
  const panel = signInPanel(page);
  await expect(panel).toBeVisible();
  await expect(sidebar(page)).toHaveCount(0);
  await chooseAccount(panel, role);
  await panel.getByLabel(s.accessCodeLabel).fill(ACCESS_CODE);
  await panel.getByRole("button", { name: s.signInSubmit, exact: true }).click();
  await expect(userCard(page)).toBeVisible();
  await expectFrame(page);

  const card = userCard(page);
  const account = demoAccount(role);
  await expect(card.locator(".user-card__avatar")).toHaveText(account[0].toUpperCase());
  await expect(card.locator(".user-card__name")).toHaveText(account);
  await expect(card.locator(".user-card__role")).toHaveText(roleName(role));
  await expect(card.getByText(scopeText(role), { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: s.signOut })).toBeVisible();

  await identityBadge(page).click();
  const sheet = identitySheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("radio")).toHaveCount(0);
  await expect(sheet.getByRole("group", { name: s.language })).toBeVisible();
  await expect(sheet.getByRole("button", { name: s.signOut })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("英文版面（#288）：左側欄與使用者卡不破版", async ({ page }) => {
  test.skip(!client.languages.includes("en"), "client.json 的 languages 沒有 en");
  await openApp(page);
  await switchIdentity(page, access.roles.at(-1)!.id);
  await switchLanguage(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect((await sidebar(page).boundingBox())!.width).toBe(220);
  expect(await sidebar(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
});
