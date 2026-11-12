// 問答的錯誤與額度（#280，docs/design.md「錯誤與額度」）：依使用者可以做什麼，出現在不同的位置。
// /api/ask 一律是 page.route 的假回應（後註冊的 route 先處理）；Worker 的錯誤格式見 worker/README.md。
import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, presetQuestions, s, switchIdentity, tab } from "./support/app";
import { event, FAKE_ANSWER_LEAD } from "./support/fake-ask";

const question = presetQuestions[0];

async function askWith(page: Page, respond: Parameters<Page["route"]>[1]) {
  await openApp(page);
  await switchIdentity(page, question.role);
  await page.route("**/api/ask", respond);
  await page.getByRole("button", { name: question.text, exact: true }).click();
}

const input = (page: Page) => page.getByPlaceholder(s.questionPlaceholder);
const json = (status: number, error: string) => ({ status, contentType: "application/json", body: JSON.stringify({ error }) });

test("今天用完了（429）：輸入框上方的說明條，停用輸入框與預設問題；問題回到輸入框，圖譜照常可用", async ({ page }) => {
  await askWith(page, (route) => route.fulfill(json(429, "daily_limit")));
  await expect(page.getByText(s.errors.daily_limit)).toBeVisible();
  await expect(page.getByText(s.qaProblems.limitBrowse)).toBeVisible();
  await expect(input(page)).toBeDisabled();
  await expect(input(page)).toHaveValue(question.text);
  await expect(page.getByRole("button", { name: question.text, exact: true })).toBeDisabled();
  await expect(page.locator("section.answer")).toHaveCount(0);

  await openTab(page, s.tabGraph);
  await expect(tab(page, s.tabGraph)).toHaveAttribute("aria-current", "page");
});

test("需要管理者（500）：對話區頂端的說明與可展開的細節；輸入框保持可用", async ({ page }) => {
  await askWith(page, (route) => route.fulfill(json(500, "misconfigured")));
  await expect(page.getByText(s.qaProblems.adminTitle)).toBeVisible();
  await expect(page.getByText(s.errors.misconfigured)).toBeVisible();
  const code = page.locator(".admin-details code");
  await expect(code).toBeHidden();
  await page.getByText(s.qaProblems.adminDetails).click();
  await expect(code).toContainText("misconfigured");
  await expect(input(page)).toBeEnabled();
  await expect(input(page)).toHaveValue(question.text);
  await expect(page.locator("section.answer")).toHaveCount(0);
});

test("串流中斷：保留已收到的文字、變淡並標「回答不完整」，可以重新提問", async ({ page }) => {
  // 只有 delta、沒有 done：前端視為中斷（upstream_interrupted）
  await askWith(page, (route) =>
    route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: event("delta", { text: `${FAKE_ANSWER_LEAD} [1]` }) }),
  );
  const answer = page.locator("section.answer");
  await expect(answer).toHaveClass(/\bincomplete\b/);
  await expect(answer.locator(".answer-text")).toContainText(FAKE_ANSWER_LEAD);
  await expect(answer.getByText(s.incomplete)).toBeVisible();
  await expect(answer.getByRole("button", { name: s.answerRetry })).toBeEnabled();
});

test("連不到伺服器：回答的位置是中性的卡片＋重新提問，頁面頂端的離線提示在 online 事件後消失", async ({ page }) => {
  await askWith(page, (route) => route.abort("internetdisconnected"));
  const answer = page.locator("section.answer");
  await expect(answer.locator(".problem")).toContainText(s.errors.network);
  await expect(answer.getByRole("button", { name: s.answerRetry })).toBeEnabled();
  const offline = page.getByText(s.qaProblems.offline);
  await expect(offline).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(offline).toHaveCount(0);
});
