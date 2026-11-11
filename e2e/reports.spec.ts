// 回答錯誤回報（ADR 0007 決定 7，#209）：問答的「回報有錯」與待審頁的「回報」分頁。/api/ask 一律是假的回應（support/fake-ask.ts）。
// 回報的可見範圍依身分不同：沒有 canReview 的身分可以回報、但看不到回報；送出的段落全部看得到的審核者看得到。
// 「送出的段落中有一段看不到時看不到該回報」以 RLS 測試驗證（app/tests/reports/store.test.ts），每個客戶都只有一個能審核的身分
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, openTab, presetQuestions, s, sourcePanel, switchIdentity, tab } from "./support/app";
import { access, language, NO_NON_REVIEWER, NO_REVIEWER, nonReviewer, reviewer } from "./support/client";
import { seesAllOf } from "./support/dataset";
import { FAKE_ANSWER_LEAD, sseBody } from "./support/fake-ask";

const NOTE = "E2E：第 1 段沒有寫這件事";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 送出一題並等回答（含回答提到）結束，回傳該題
async function ask(page: Page, question: string, preset: boolean): Promise<Locator> {
  if (preset) await page.getByRole("button", { name: question, exact: true }).click();
  else {
    await page.getByPlaceholder(s.questionPlaceholder).fill(question);
    await page.getByRole("button", { name: s.askButton, exact: true }).click();
  }
  const answer = page.locator("section.answer").last();
  await expect(answer.getByRole("heading", { name: question })).toBeVisible();
  await expect(answer.getByText(s.answering)).toHaveCount(0);
  return answer;
}

// 左側「待審」頁籤的筆數（待審項目＋未處理的回報）
const tabCount = (page: Page) => tab(page, s.tabReview).locator(".tab-count");

async function reviewCount(page: Page): Promise<number> {
  await expect(tabCount(page)).toHaveText(/^\d+$/);
  return Number(await tabCount(page).textContent());
}

// 待審頁的「回報」分頁；分頁名稱後面接著未處理的筆數，所以比對開頭
async function openReports(page: Page): Promise<void> {
  await openTab(page, s.tabReview);
  await page
    .getByRole("tablist", { name: s.reviewStatusTabs })
    .getByRole("tab", { name: new RegExp(`^${escape(s.reviewReportsTab)}`) })
    .click();
}

test("沒有 canReview 的身分回報回答；審核者在「回報」分頁看到、打開原文、標示為不是錯誤", async ({ page }) => {
  test.skip(nonReviewer === undefined || reviewer === undefined, nonReviewer === undefined ? NO_NON_REVIEWER : NO_REVIEWER);
  const question = presetQuestions.find((q) => q.role === nonReviewer!.id)?.text;
  test.skip(question === undefined, `scenarios.json 沒有 ${nonReviewer!.id} 的預設問題`);
  test.skip(!seesAllOf(reviewer!.id, nonReviewer!.id), `${reviewer!.id} 看不到 ${nonReviewer!.id} 看得到的所有段落`);

  await openApp(page);
  await switchIdentity(page, reviewer!.id);
  const before = await reviewCount(page);
  await switchIdentity(page, nonReviewer!.id);
  const answer = await ask(page, question!, true);
  await expect(answer.getByText(FAKE_ANSWER_LEAD)).toBeVisible();
  await answer.getByRole("button", { name: s.reportButton }).click();
  const form = answer.getByRole("form", { name: s.reportButton });
  // 回答的預設原因是「內容有誤」
  await expect(form.locator("select")).toHaveValue("wrong_fact");
  await form.locator("select").selectOption("wrong_citation");
  await form.locator("textarea").fill(NOTE);
  await form.getByRole("button", { name: s.reportSubmit }).click();
  await expect(answer.getByText(s.reportSent)).toBeVisible();
  await expect(answer.getByRole("button", { name: s.reportButton })).toHaveCount(0);
  // 沒有 canReview：沒有待審頁籤，看不到回報
  await expect(tab(page, s.tabReview)).toHaveCount(0);

  await switchIdentity(page, reviewer!.id);
  // 未處理的回報算進審核者的待審筆數
  await expect(tabCount(page)).toHaveText(String(before + 1));
  await openReports(page);
  const card = page.getByRole("region", { name: question! });
  const reporter = access.roles.find((r) => r.id === nonReviewer!.id)!.label[language];
  await expect(card).toContainText(reporter);
  await expect(card).toContainText(s.reportCategories.wrong_citation);
  await expect(card).toContainText(NOTE);
  await expect(card).toContainText(FAKE_ANSWER_LEAD);

  // 引用編號打開原文
  await card.getByRole("button", { name: "1", exact: true }).click();
  await expect(sourcePanel(page)).toBeVisible();

  await card.getByRole("button", { name: s.reportMarkNotError }).click();
  await expect(card).toContainText(s.reportResolutions.not_error);
  await expect(card.getByRole("button", { name: s.reportMarkNotError })).toHaveCount(0);
  // 處理後不再算進待審筆數
  await expect(tabCount(page)).toHaveText(String(before));
});

test("拒答的回報只含問題文字，預設原因是「資料中有答案，卻拒答了」", async ({ page }) => {
  test.skip(reviewer === undefined, NO_REVIEWER);
  await openApp(page);
  // 檢索到段落而送出 /api/ask 時也拒答（app/src/qa/prompt.ts 的 REFUSAL_MARKER）
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string };
    if (!(body.system ?? "").startsWith("You answer questions")) return route.fallback();
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody("[[NO_ANSWER]]") });
  });
  await switchIdentity(page, reviewer!.id);
  const before = await reviewCount(page);
  const question = "E2E qzxv wkjp";
  const answer = await ask(page, question, false);
  await expect(answer.getByText(s.refusal)).toBeVisible();
  await answer.getByRole("button", { name: s.reportButton }).click();
  const form = answer.getByRole("form", { name: s.reportButton });
  await expect(form.locator("select")).toHaveValue("should_answer");
  await form.getByRole("button", { name: s.reportSubmit }).click();
  await expect(answer.getByText(s.reportSent)).toBeVisible();
  // 審核者自己回報時，待審筆數在送出後加一
  await expect(tabCount(page)).toHaveText(String(before + 1));

  await openReports(page);
  const card = page.getByRole("region", { name: question });
  await expect(card).toContainText(s.reportCategories.should_answer);
  await expect(card).toContainText(s.reportRefusal);
  await expect(card.locator("button.citation")).toHaveCount(0);
  // 拒答沒有可撤回的內容，只能標示為不是錯誤
  await expect(card.getByRole("button", { name: s.reportMarkRetracted })).toHaveCount(0);
  await expect(card.getByRole("button", { name: s.reportMarkNotError })).toBeVisible();
});
