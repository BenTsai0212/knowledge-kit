// 登入頁的兩條路（#287，docs/design.md「日常工具」的「登入」）：登入頁沒有身分選單；帳號登入（展示）身分固定、不能切換；使用邀請碼體驗與展示模式進入後可以切換。
// 這個 build 沒有公開碼（線上 demo 的帳號登入見 demo.spec.ts），所以帳號登入也要輸入邀請碼。/api/ask 一律是假的回應。
import { expect, test, type Page } from "@playwright/test";
import { ACCESS_CODE, accountOption, blockModelDownload, identitySegments, language, openApp, presetQuestions, s, signInPanel, switchIdentity } from "./support/app";
import { access } from "./support/client";
import { routeFakeAsk } from "./support/fake-ask";

const identityMenu = (page: Page) => page.getByRole("banner").getByLabel(s.identity);

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
  await expect(page.getByText(s.signInNoPassword)).toBeVisible();

  const login = panel.getByRole("button", { name: s.signInSubmit, exact: true });
  await panel.getByLabel(s.signInAccount).selectOption({ label: accountOption(question.role) });
  // 沒有公開碼：沒填邀請碼不能登入
  await expect(login).toBeDisabled();
  await panel.getByLabel(s.accessCodeLabel).fill(ACCESS_CODE);
  await login.click();
  await expect(page.getByRole("button", { name: question.text, exact: true })).toBeEnabled();

  // 身分是登入的帳號：沒有選單，顯示帳號與角色
  await expect(identityMenu(page)).toHaveCount(0);
  await expect(page.getByRole("banner")).toContainText(accountOption(question.role));
  // 帳號與邀請碼都不寫入瀏覽器的儲存：重新整理後回到登入頁
  const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
  expect(stored).not.toContain(ACCESS_CODE);
  expect(stored).not.toContain("@example.test");

  const request = page.waitForRequest("**/api/ask");
  await page.getByRole("button", { name: question.text, exact: true }).click();
  expect((await request).headers()["x-access-code"]).toBe(ACCESS_CODE);

  await page.getByRole("button", { name: s.signOut }).click();
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
    await expect(identityMenu(page)).toHaveValue(role.id);
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
