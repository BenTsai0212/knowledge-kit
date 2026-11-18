// 原文面板的來源確認（ADR 0013 決定 3、4、8，#417 PR 3）：能審查的身分只在引用段落下方看到「確認這段」→ 顯示「這段原文已確認 · 〈角色〉於〈日期〉確認」
// 與「撤銷確認」（焦點移到這裡）→ 撤銷後回到未確認（焦點回到「確認這段」）→ 再確認一次；不能審查的身分打開原文時看不到任何按鈕。
// 桌機 1440×900（原文欄）、手機 390×844（底部面板）各走一次，截圖附在測試報告（CI 的 E2E artifact）。
// 完整流程（一般員工的回答看到標記、說法不同後失效、看不到的身分沒有痕跡）在 #417 PR 5。/api/ask 一律是假的回應（引用第 1 段）
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openApp, passSameName, presetQuestions, s, switchIdentity } from "./support/app";
import { language, nonReviewer, NO_NON_REVIEWER, NO_REVIEWER, reviewer } from "./support/client";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

// 問一題、打開第 1 個引用的原文，回傳原文紙面
async function askAndOpenSource(page: Page, question: string): Promise<Locator> {
  await page.getByPlaceholder(s.questionPlaceholder).fill(question);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  const answer = page.locator("section.answer").last();
  await passSameName(answer);
  await answer.locator("button.citation").first().click();
  const text = page.locator(".source-text");
  await expect(text.locator(".highlight")).toBeVisible();
  return text;
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}：確認這段、撤銷確認；不能審查的身分看不到按鈕`, async ({ page }, testInfo) => {
    test.skip(reviewer === undefined, NO_REVIEWER);
    test.skip(nonReviewer === undefined, NO_NON_REVIEWER);
    test.setTimeout(180_000);
    const tag = `${viewport.width}`;
    const question = (presetQuestions.find((q) => q.role === reviewer!.id) ?? presetQuestions[0]).text;
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openApp(page);
    await switchIdentity(page, reviewer!.id);

    let text = await askAndOpenSource(page, question);
    // 引用段落的下方（桌機在 ¶N 右側的同一欄）
    const confirm = text.locator(".highlight + .source-confirm").getByRole("button", { name: s.sourceConfirm, exact: true });
    await expect(confirm).toBeVisible();
    // 「確認這段」只在標示的出處段落，其他段落沒有
    await expect(text.getByRole("button", { name: s.sourceConfirm, exact: true })).toHaveCount(1);
    await screenshot(page, testInfo, `source-confirm-before-${tag}.png`);

    await confirm.click();
    const group = text.locator(".highlight + .source-confirmation");
    const revoke = group.getByRole("button", { name: s.sourceConfirmRevoke, exact: true });
    await expect(group).toHaveAttribute("aria-label", s.sourceConfirmGroup);
    await expect(group).toContainText(s.sourceConfirmed);
    await expect(group).toContainText(reviewer!.label[language]);
    await expect(revoke).toBeVisible();
    // 確認後焦點在同一段的「撤銷確認」
    await expect(revoke).toBeFocused();
    await group.scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, `source-confirm-confirmed-${tag}.png`);

    // 撤銷後回到未確認（紀錄保留，畫面不列歷史），焦點回到同一段的「確認這段」；再確認一次
    await revoke.click();
    await expect(text.locator(".source-confirmation")).toHaveCount(0);
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeFocused();
    await confirm.click();
    await expect(group).toContainText(s.sourceConfirmed);
    await page.keyboard.press("Escape");

    // 不能審查的身分：沒有「確認這段」「撤銷確認」
    await switchIdentity(page, nonReviewer!.id);
    text = await askAndOpenSource(page, question);
    await expect(text.getByRole("button", { name: s.sourceConfirm, exact: true })).toHaveCount(0);
    await expect(text.getByRole("button", { name: s.sourceConfirmRevoke, exact: true })).toHaveCount(0);
    await screenshot(page, testInfo, `source-confirm-reader-${tag}.png`);
  });
}
