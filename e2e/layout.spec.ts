// 問答頁的三欄版面（#195，docs/qa.md「畫面」）：左導覽、中間對話、右側原文面板。/api/ask 一律是假的回應。
import { expect, test, type Page } from "@playwright/test";
import { openApp, presetQuestions, s, sourcePanel, switchIdentity } from "./support/app";
import { access } from "./support/client";
import { askStreamOpen, event, FAKE_ANSWER_LEAD, holdAskStream, pushAskStream } from "./support/fake-ask";

const question = presetQuestions[0];
const answers = (page: Page) => page.locator("section.answer");

// 按預設問題，等到這一題的回答結束（第 n 題，從 1 開始），回傳送出的 /api/ask 請求本文
async function askPreset(page: Page, n: number): Promise<string> {
  const request = page.waitForRequest("**/api/ask");
  await page.getByRole("button", { name: question.text, exact: true }).click();
  const body = (await request).postData() ?? "";
  await expect(answers(page)).toHaveCount(n);
  await expect(answers(page).nth(n - 1)).toContainText(FAKE_ANSWER_LEAD);
  return body;
}

test.describe("1280×720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("第一個畫面看得到輸入框、最新一題的回答與右側面板，整頁不捲動", async ({ page }) => {
    await openApp(page);
    await switchIdentity(page, question.role);
    await askPreset(page, 1);
    await askPreset(page, 2);
    const latest = answers(page).last();
    await latest.getByRole("button", { name: "1", exact: true }).click();

    await expect(sourcePanel(page)).toBeInViewport();
    await expect(sourcePanel(page).locator("mark")).toBeInViewport();
    await expect(page.getByPlaceholder(s.questionPlaceholder)).toBeInViewport();
    await expect(latest).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  });

  test("問答往下累積、輸入框固定在下方、每題獨立回答；切換身分時清除", async ({ page }) => {
    await openApp(page);
    await switchIdentity(page, question.role);
    const input = page.getByPlaceholder(s.questionPlaceholder);
    await expect(page.getByText(s.qaIndependent)).toBeVisible();
    const before = await input.boundingBox();

    const first = await askPreset(page, 1);
    const second = await askPreset(page, 2);
    // 同一題問兩次，送出的內容相同：第二題不帶上一題的問題與回答
    expect(second).toBe(first);
    expect(await input.boundingBox()).toEqual(before);
    await expect(answers(page).getByRole("heading", { name: question.text })).toHaveCount(2);
    const sessionQuestions = page.getByRole("navigation", { name: s.sessionQuestions }).getByRole("link");
    await expect(sessionQuestions).toHaveText([question.text, question.text]);

    await switchIdentity(page, access.roles.find((r) => r.id !== question.role)!.id);
    await expect(answers(page)).toHaveCount(0);
    await expect(sessionQuestions).toHaveCount(0);
    await expect(page.getByText(s.emptyAnswer)).toBeVisible();
  });

  test("回答串流中停用送出與預設問題，結束後恢復", async ({ page }) => {
    await holdAskStream(page);
    await openApp(page);
    await switchIdentity(page, question.role);
    const preset = page.getByRole("button", { name: question.text, exact: true });
    await preset.click();
    await expect.poll(() => askStreamOpen(page)).toBe(true);

    await page.getByPlaceholder(s.questionPlaceholder).fill("E2E");
    await expect(preset).toBeDisabled();
    await expect(page.getByRole("button", { name: s.askButton, exact: true })).toBeDisabled();

    await pushAskStream(page, event("delta", { text: `${FAKE_ANSWER_LEAD} [1]` }) + event("done", { stopReason: "end_turn" }));
    await expect(answers(page)).toContainText(FAKE_ANSWER_LEAD);
    await expect(preset).toBeEnabled();
    await expect(page.getByRole("button", { name: s.askButton, exact: true })).toBeEnabled();
  });
});

test.describe("手機寬度", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("三欄上下堆疊，可以提問與看原文", async ({ page }) => {
    await openApp(page);
    await switchIdentity(page, question.role);
    await askPreset(page, 1);
    // 頂端列在對話上方、分頁列在視窗底部（#255），整頁沒有橫向捲動
    const top = await page.getByRole("banner").boundingBox();
    const nav = await page.getByRole("navigation", { name: s.views }).boundingBox();
    const answer = await answers(page).first().boundingBox();
    expect(top!.y).toBeLessThan(answer!.y);
    expect(nav!.y + nav!.height).toBeCloseTo(844, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await answers(page).first().getByRole("button", { name: "1", exact: true }).click();
    await expect(sourcePanel(page).locator("mark")).toBeInViewport();
  });
});
