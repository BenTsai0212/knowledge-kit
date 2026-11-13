// 桌機問答頁的狀態（#335 PR 2，畫板 K-Answer、I-States）：拒答的下一步是並排的卡片、錯誤是回答卡片內的圖示＋訊息＋「問題已保留…」，
// 額度用完與需要管理者的說明條、「回報有錯」的次要按鈕。1440×900，每一步都檢查沒有橫向捲動，截圖附在測試報告。
// 文字與行為由 qa-errors.spec.ts、access.spec.ts、reports.spec.ts 檢查；這裡只看桌機的版面與顏色。/api/ask 一律是假的回應
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { REFUSAL_MARKER } from "../app/src/qa/prompt";
import { openApp, presetQuestions, s, switchIdentity } from "./support/app";
import { sseBody } from "./support/fake-ask";

test.use({ viewport: { width: 1440, height: 900 } });

const question = presetQuestions[0];
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (el: Locator) => (await el.boundingBox())!;
const json = (status: number, error: string) => ({ status, contentType: "application/json", body: JSON.stringify({ error }) });
const tokenColor = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--color-${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

// 問答的請求才換成 respond，其他（萃取等）照常是假的回應
async function askWith(page: Page, respond: Parameters<Page["route"]>[1]) {
  await openApp(page);
  await switchIdentity(page, question.role);
  await page.route("**/api/ask", async (route, request) => {
    const body = request.postDataJSON() as { system?: string };
    if (!(body.system ?? "").startsWith("You answer questions")) return route.fallback();
    return respond(route, request);
  });
  await page.getByRole("button", { name: question.text, exact: true }).click();
}

test("拒答：回答卡片內「可以試試」，下一步是並排的 surfaceRaised 卡片（小標＋內容）", async ({ page }, testInfo) => {
  await askWith(page, (route) => route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(REFUSAL_MARKER) }));
  const answer = page.locator("section.answer").last();
  const body = answer.locator(".answer__body");
  await expect(body.locator(".refusal")).toContainText(s.refusal);
  await expect(body.locator(".refusal")).toHaveCSS("border-top-style", "none");
  const cards = body.locator(".refusal-next li:not(.refusal-next__upload)");
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(2);
  const first = await box(cards.first());
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS("background-color", await tokenColor(page, "surfaceRaised"));
    await expect(card.locator(".refusal-kind")).toBeVisible();
    // 並排：最多三張在同一列
    if (count <= 3) expect(Math.abs((await box(card)).y - first.y)).toBeLessThanOrEqual(1);
  }
  expect((await box(body)).width).toBeLessThanOrEqual(760);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "qa-desktop-refusal");
});

test("暫時的問題：回答卡片內的圖示＋訊息＋「問題已保留…」＋重新提問", async ({ page }, testInfo) => {
  await askWith(page, (route) => route.abort("internetdisconnected"));
  const body = page.locator("section.answer .answer__body");
  const problem = body.locator(".problem");
  await expect(problem).toContainText(s.errors.network);
  await expect(problem.locator(".problem-icon")).toBeVisible();
  await expect(problem.getByText(s.qaProblems.kept)).toBeVisible();
  await expect(problem).toHaveCSS("border-top-style", "none");
  const retry = body.getByRole("button", { name: s.answerRetry });
  await expect(retry).toBeEnabled();
  // 「重新提問」與訊息左緣對齊（圖示在左）
  const message = await box(problem.getByText(s.errors.network));
  expect(Math.abs((await box(retry)).x - message.x)).toBeLessThanOrEqual(1);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "qa-desktop-error");
});

test("今天用完了：輸入列上方 surfaceRaised 底的說明條", async ({ page }, testInfo) => {
  await askWith(page, (route) => route.fulfill(json(429, "daily_limit")));
  const notice = page.locator(".notice--limit");
  await expect(notice).toContainText(s.errors.daily_limit);
  await expect(notice).toHaveCSS("background-color", await tokenColor(page, "surfaceRaised"));
  // 說明條在輸入列上方
  expect((await box(notice)).y).toBeLessThan((await box(page.locator(".composer--line .free-question"))).y);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "qa-desktop-limit");
});

test("需要管理者：對話區頂端 conflictSoft 底、conflictText 字的說明", async ({ page }) => {
  await askWith(page, (route) => route.fulfill(json(500, "misconfigured")));
  const notice = page.locator(".notice--admin");
  await expect(notice).toContainText(s.qaProblems.adminTitle);
  await expect(notice).toHaveCSS("background-color", await tokenColor(page, "conflictSoft"));
  await expect(notice).toHaveCSS("color", await tokenColor(page, "conflictText"));
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("「回報有錯」是回答卡片內的次要按鈕（36px、圓角 8px）", async ({ page }) => {
  await openApp(page);
  await switchIdentity(page, question.role);
  await page.getByRole("button", { name: question.text, exact: true }).click();
  const body = page.locator("section.answer .answer__body");
  const report = body.getByRole("button", { name: s.reportButton, exact: true });
  await expect(report).toBeVisible();
  expect(Math.round((await box(report)).height)).toBe(36);
  await expect(report).toHaveCSS("border-top-left-radius", "8px");
  await expect(report).toHaveCSS("background-color", await tokenColor(page, "surface"));
});
