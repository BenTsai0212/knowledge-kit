// 回答的引用標號的小標記（ADR 0013 決定 8，#417 PR 4）：能審查的身分在原文面板確認引用的段落後，回答中的引用標號加上小圓點、
// aria-label 為「引用 N，這段原文已確認」；撤銷後圓點消失；之後再問一題時，新的回答也有標記。
// 桌機 1440×900、手機 390×844 各走一次，截圖附在測試報告（CI 的 E2E artifact）。
// 完整流程（一般員工的回答看到標記、說法不同後失效、看不到的身分沒有痕跡）在 #417 PR 5。/api/ask 一律是假的回應（引用第 1 段）
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openApp, passSameName, presetQuestions, s, switchIdentity } from "./support/app";
import { NO_REVIEWER, reviewer } from "./support/client";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const label = (n: number) => s.citationConfirmed.replace("{n}", String(n));
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

// 關掉原文。手機的原文是原生 <dialog> 的底部面板：Esc 後先播退場動畫（base）才 close()，這段期間面板仍是 modal、
// 面板外的元素是 inert。fill() 不檢查點擊目標，焦點進不了 inert 的輸入框，打的字不會進去，「提問」一直停用。
// 所以等面板收起再往下（與 e2e/support/app.ts 的身分面板相同）。桌機的原文在右側面板，不是 <dialog>，這裡直接通過
async function closeSource(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.source-sheet")).toBeHidden();
}

async function ask(page: Page, question: string): Promise<Locator> {
  const input = page.getByPlaceholder(s.questionPlaceholder);
  await input.fill(question);
  await expect(input).toHaveValue(question);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  const answer = page.locator("section.answer").last();
  await passSameName(answer);
  await expect(answer.locator("button.citation").first()).toBeVisible();
  return answer;
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}：確認引用的段落後，引用標號加上小標記；撤銷後消失`, async ({ page }, testInfo) => {
    test.skip(reviewer === undefined, NO_REVIEWER);
    test.setTimeout(180_000);
    const tag = `${viewport.width}`;
    const question = (presetQuestions.find((q) => q.role === reviewer!.id) ?? presetQuestions[0]).text;
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openApp(page);
    await switchIdentity(page, reviewer!.id);

    const answer = await ask(page, question);
    const first = answer.locator("button.citation").first();
    // 還沒確認：沒有標記
    await expect(answer.locator(".citation--confirmed")).toHaveCount(0);

    await first.click();
    const text = page.locator(".source-text");
    await text.locator(".highlight + .source-confirm").getByRole("button", { name: s.sourceConfirm, exact: true }).click();
    await expect(text.locator(".highlight + .source-confirmation")).toContainText(s.sourceConfirmed);
    await closeSource(page);

    // 回答中的標號：小圓點與 aria-label
    await expect(first).toHaveClass(/citation--confirmed/);
    await expect(first).toHaveAttribute("aria-label", label(1));
    await expect(first).toHaveAttribute("title", s.citationConfirmedHint);
    await expect(first.locator(".citation__confirmed")).toBeVisible();
    const dot = await first.locator(".citation__confirmed").boundingBox();
    expect(dot?.width).toBeCloseTo(5, 0);
    await first.scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, `citation-confirmed-${tag}.png`);

    // 選取狀態（原文已開）：圓點仍看得到
    await first.click();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect(first.locator(".citation__confirmed")).toBeVisible();
    await screenshot(page, testInfo, `citation-confirmed-selected-${tag}.png`);

    // 新的一題：回答完成時就有標記
    await closeSource(page);
    const next = await ask(page, question);
    await expect(next.locator("button.citation").first()).toHaveAttribute("aria-label", label(1));

    // 撤銷後標記消失（已經回答的題目也跟著更新）
    await next.locator("button.citation").first().click();
    await text.locator(".highlight + .source-confirmation").getByRole("button", { name: s.sourceConfirmRevoke, exact: true }).click();
    await expect(text.locator(".source-confirmation")).toHaveCount(0);
    await closeSource(page);
    await expect(page.locator("section.answer .citation--confirmed")).toHaveCount(0);
    await expect(first).not.toHaveAttribute("aria-label", /./);
    await expect(first).toHaveAttribute("title", s.openSource);
  });
}
