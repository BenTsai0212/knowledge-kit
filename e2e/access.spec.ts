// 畫面層的越權測試（#66）：切換身分後，畫面上不殘留新身分看不到的內容。
// 看不到的段落以 app/src/evals/oracle.ts 算出（support/dataset.ts），不以畫面或資料庫的結果為準。
import { expect, test, type Page } from "@playwright/test";
import { EVALS_PATH, expandTimelineEntry, language, openApp, openTab, presetQuestions, s, sourcePanel, switchIdentity, tab, type RoleId } from "./support/app";
import { access, NO_NON_REVIEWER, NO_REVIEWER, nonReviewer, reviewer } from "./support/client";
import { hiddenDocument, hiddenPassages, leakedPassages, visibleNamesIn } from "./support/dataset";
import { askStreamCancelled, askStreamOpen, event, holdAskStream, pushAskStream, sseBody } from "./support/fake-ask";

const roles = access.roles.map((r) => r.id);
// 切換前看得最多的身分：能審查的身分中 rank 最高者（參考情境是 manager）；沒有時用第一個身分
const viewer = reviewer?.id ?? roles[0];
const lessPrivileged = roles.filter((id) => id !== viewer);
// 串流中的回答：虛構的文字，只用來確認切換身分後不再出現
const PARTIAL = "串流中的部分回答";

// 整個頁面上出現的、該身分看不到的段落
const leaked = async (page: Page, role: RoleId) => leakedPassages(await page.locator("body").innerText(), role);

for (const role of lessPrivileged) {
  test(`打開原文後切換成 ${role}：原文面板與時間軸不殘留看不到的段落`, async ({ page }) => {
    const docId = hiddenDocument(role, viewer, language);
    test.skip(docId === undefined, `資料集中沒有 ${viewer} 看得到、${role} 完全看不到的 ${language} 文件`);
    await openApp(page);
    await switchIdentity(page, viewer);
    await openTab(page, s.tabTimeline);
    const doc = page.locator(`ol.timeline > li[data-document-id="${docId}"]`);
    await expandTimelineEntry(doc);
    await doc.getByRole("button", { name: s.openSource }).first().click();
    await expect(sourcePanel(page)).toBeVisible();
    // 比對本身有效：切換前畫面上確實有該身分看不到的段落
    expect(await leaked(page, role)).not.toEqual([]);

    await switchIdentity(page, role);
    await expect(sourcePanel(page)).toBeHidden();
    await expect(doc).toBeHidden();
    await expect(page.locator("ol.timeline > li").first()).toBeVisible();
    await expect(async () => expect(await leaked(page, role)).toEqual([])).toPass({ timeout: 30_000 });
  });
}

test("串流回答中切換身分：回答不再出現，之後到的內容也不顯示", async ({ page }) => {
  const question = presetQuestions.find((q) => q.role !== roles[0]);
  test.skip(question === undefined, `scenarios.json 沒有 ${roles[0]} 以外身分的預設問題`);
  await holdAskStream(page);
  await openApp(page);
  await switchIdentity(page, question!.role);
  await page.getByRole("button", { name: question!.text, exact: true }).click();
  await expect.poll(() => askStreamOpen(page)).toBe(true);

  await pushAskStream(page, event("delta", { text: PARTIAL }));
  const answer = page.locator("section.answer");
  await expect(answer).toContainText(PARTIAL);

  await switchIdentity(page, roles[0]);
  await expect(answer).toBeHidden();
  await expect(page.getByText(s.emptyAnswer)).toBeVisible();

  // 切換後才到的內容：前端讀到後捨棄並取消串流，畫面不變
  await pushAskStream(page, event("delta", { text: `${PARTIAL} [1]` }) + event("done", { stopReason: "end_turn" }));
  await expect.poll(() => askStreamCancelled(page)).toBe(true);
  await expect(page.getByText(PARTIAL)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: question!.text })).toHaveCount(0);
  await expect(page.getByText(s.emptyAnswer)).toBeVisible();
});

test("對話依身分分開保存：切到另一個身分時畫面上沒有前一個身分的問答，切回來看得到（#303）", async ({ page }) => {
  test.skip(roles.length < 2, "只有一個身分");
  const [a, b] = roles;
  const question = `E2E：只有 ${a} 問過的問題`;
  await openApp(page);
  await switchIdentity(page, a);
  await page.getByPlaceholder(s.questionPlaceholder).fill(question);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  const answer = page.locator("section.answer");
  await expect(answer.getByRole("heading", { name: question })).toBeVisible();
  await expect(answer.getByText(s.answering)).toHaveCount(0);

  await switchIdentity(page, b);
  await expect(answer).toHaveCount(0);
  await expect(page.getByText(question)).toHaveCount(0);
  await expect(page.getByText(s.emptyAnswer)).toBeVisible();

  await switchIdentity(page, a);
  await expect(answer).toHaveCount(1);
  await expect(answer.getByRole("heading", { name: question })).toBeVisible();
  await expect(answer.getByText(s.answering)).toHaveCount(0);
});

test("待審只給 canReview 的身分；沒有 tools=evals 時，所有身分都看不到評測台", async ({ page }) => {
  await openApp(page);
  for (const role of access.roles) {
    await switchIdentity(page, role.id);
    await expect(tab(page, s.tabQa)).toBeVisible();
    await expect(tab(page, s.tabReview)).toHaveCount(role.canReview ? 1 : 0);
    await expect(tab(page, s.tabEvals)).toHaveCount(0);
  }
});

test("tools=evals 時，待審與評測台的頁籤只給 canReview 的身分", async ({ page }) => {
  await openApp(page, EVALS_PATH);
  for (const role of access.roles) {
    await switchIdentity(page, role.id);
    await expect(tab(page, s.tabQa)).toBeVisible();
    for (const label of [s.tabReview, s.tabEvals]) await expect(tab(page, label)).toHaveCount(role.canReview ? 1 : 0);
  }
});

test("在評測台切換成沒有 canReview 的身分：回到問答，頁籤消失", async ({ page }) => {
  test.skip(reviewer === undefined, NO_REVIEWER);
  test.skip(nonReviewer === undefined, NO_NON_REVIEWER);
  await openApp(page, EVALS_PATH);
  await switchIdentity(page, reviewer!.id);
  await openTab(page, s.tabEvals);
  await expect(page.getByRole("button", { name: s.evalStart })).toBeVisible();

  await switchIdentity(page, nonReviewer!.id);
  await expect(page.getByRole("button", { name: s.evalStart })).toHaveCount(0);
  await expect(tab(page, s.tabEvals)).toHaveCount(0);
  await expect(tab(page, s.tabQa)).toHaveAttribute("aria-current", "page");
});

// 查不到時的下一步（#192）：「資料沒寫」與「看不到的資料」的拒答區塊完全相同，不透露是哪一種。
// 下一步會從問題中看得到的實體產生（#285），所以「資料沒寫」的問題也放進同樣的看得到的實體名稱
// 問答一律回拒答標記（app/src/qa/prompt.ts 的 REFUSAL_MARKER），檢索到看得到的段落而送出 /api/ask 時也拒答
const REFUSAL_MARKER = "[[NO_ANSWER]]";

for (const role of lessPrivileged) {
  test(`${role} 查不到時：資料沒寫與看不到的資料，拒答與下一步相同`, async ({ page }) => {
    const hidden = hiddenPassages(role)[0];
    test.skip(hidden === undefined, `資料集中沒有 ${role} 看不到的段落`);
    await openApp(page);
    await page.route("**/api/ask", async (route) => {
      const body = route.request().postDataJSON() as { system?: string };
      if (!(body.system ?? "").startsWith("You answer questions")) return route.fallback();
      await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(REFUSAL_MARKER) });
    });
    await switchIdentity(page, role);

    // 問答往下累積（#195），看最新一題
    const answer = page.locator("section.answer").last();
    const ask = async (question: string) => {
      await page.getByPlaceholder(s.questionPlaceholder).fill(question);
      await page.getByRole("button", { name: s.askButton, exact: true }).click();
      await expect(answer.getByRole("heading", { name: question })).toBeVisible();
      await expect(answer.locator(".refusal-next")).toBeVisible();
      return answer.locator(".answer-text, .refusal-next").allInnerTexts();
    };
    // 資料沒寫：資料集中沒有的詞，加上段落開頭中看得到的實體名稱；看不到的資料：該身分看不到的段落開頭（問題本身含有這段文字，所以不做滲漏比對）
    const notWritten = await ask(["E2E qzxv wkjp", ...visibleNamesIn(hidden.prefix, role)].join(" "));
    const notVisible = await ask(hidden.prefix);
    expect(notVisible).toEqual(notWritten);
    expect(notWritten[0]).toBe(s.refusal);

    const canUpload = access.roles.find((r) => r.id === role)!.canUpload;
    const gotoUpload = answer.getByRole("button", { name: s.refusalGotoUpload });
    await expect(gotoUpload).toHaveCount(canUpload ? 1 : 0);
    if (canUpload) {
      await gotoUpload.click();
      await expect(tab(page, s.tabUpload)).toHaveAttribute("aria-current", "page");
    }
  });
}
