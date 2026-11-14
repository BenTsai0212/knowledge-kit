// 桌機的評測台與品質報告（#347，畫板 docs/design/v1/boards/F-Evals.dc.html、J-Report.dc.html）：1440×900 時評測台有 h1、
// 按鈕列三個按鈕（開始評測、下載 JSON、下載品質報告）；跑完評測後總覽是表格、點一列在下方展開，「下載品質報告」直接用這次的結果產生，
// HTML 有兩個以上的頁面區塊（section.page）與每頁的頁碼。截圖附在報告（evals-1440px.png、quality-report.png）。
// /api/ask 一律是假的回應（openApp）；語意模型的下載被擋下，選用語意向量的客戶以 keyword-hash 評測
import { readFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { EVALS_PATH, openApp, openTab, s, switchIdentity } from "./support/app";
import { NO_REVIEWER, reviewer } from "./support/client";

const screenshot = async (page: Page, testInfo: TestInfo, name: string) =>
  testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
const actions = (page: Page) => page.locator(".eval-actions button");
const pageLabel = (page: number, pages: number) => s.evalReport.page.replace("{page}", String(page)).replace("{pages}", String(pages));

test.describe("1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    test.skip(reviewer === undefined, NO_REVIEWER);
    await openApp(page, EVALS_PATH);
    await switchIdentity(page, reviewer!.id);
    await openTab(page, s.tabEvals);
  });

  test("頁首 h1、按鈕列三個按鈕；評測前只能開始評測", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: s.tabEvals })).toBeVisible();
    await expect(actions(page)).toHaveText([s.evalStart, s.evalDownload, s.evalReport.download]);
    await expect(actions(page).nth(0)).toBeEnabled();
    await expect(actions(page).nth(1)).toBeDisabled();
    await expect(actions(page).nth(2)).toBeDisabled();
    // 三個按鈕在同一列
    const tops = await actions(page).evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  });

  test("跑完評測：總覽是表格、點一列在下方展開；品質報告有兩頁以上與頁碼", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await actions(page).nth(0).click();
    const dialog = page.getByRole("dialog", { name: s.evalConfirmTitle });
    await dialog.getByRole("button", { name: s.evalConfirmStart, exact: true }).click();
    await expect(actions(page).nth(2)).toBeEnabled({ timeout: 240_000 });

    await expect(page.locator(".eval-summary table")).toBeVisible();
    await expect(page.locator(".eval-summary tbody tr")).toHaveCount(4);
    // 評測完成後不留進度格
    await expect(page.locator(".eval-summary .eval-progress")).toHaveCount(0);

    // 點一列（題號的格子）在下方展開，再點一次收起
    const row = page.locator("tr.eval-row").first();
    const question = row.locator("button.eval-question");
    await row.locator("td.eval-number").click();
    await expect(question).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("tr.eval-detail")).toHaveCount(1);
    await screenshot(page, testInfo, "evals-1440px.png");
    await question.click();
    await expect(question).toHaveAttribute("aria-expanded", "false");

    const download = page.waitForEvent("download");
    await actions(page).nth(2).click();
    const html = readFileSync((await (await download).path())!, "utf8");
    const pages = html.match(/<section class="page /g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(2);
    for (let i = 1; i <= pages; i++) expect(html).toContain(`<span>${pageLabel(i, pages)}</span></footer>`);

    await page.setContent(html);
    await expect(page.locator("section.page")).toHaveCount(pages);
    await screenshot(page, testInfo, "quality-report.png");
  });
});
