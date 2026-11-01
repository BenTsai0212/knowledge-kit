// 畫面層的越權測試（#66）：切換身分後，畫面上不殘留新身分看不到的內容。
// 看不到的段落以 app/src/evals/oracle.ts 算出（support/dataset.ts），不以畫面或資料庫的結果為準。
import { expect, test, type Page } from "@playwright/test";
import { language, openApp, openTab, presetQuestions, s, sourcePanel, switchIdentity, tab, type RoleId } from "./support/app";
import { access, NO_NON_REVIEWER, NO_REVIEWER, nonReviewer, reviewer } from "./support/client";
import { hiddenDocument, leakedPassages } from "./support/dataset";
import { askStreamCancelled, askStreamOpen, event, holdAskStream, pushAskStream } from "./support/fake-ask";

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

test("待審與評測台的頁籤只給 canReview 的身分", async ({ page }) => {
  await openApp(page);
  for (const role of access.roles) {
    await switchIdentity(page, role.id);
    await expect(tab(page, s.tabQa)).toBeVisible();
    for (const label of [s.tabReview, s.tabEvals]) await expect(tab(page, label)).toHaveCount(role.canReview ? 1 : 0);
  }
});

test("在評測台切換成沒有 canReview 的身分：回到問答，頁籤消失", async ({ page }) => {
  test.skip(reviewer === undefined, NO_REVIEWER);
  test.skip(nonReviewer === undefined, NO_NON_REVIEWER);
  await openApp(page);
  await switchIdentity(page, reviewer!.id);
  await openTab(page, s.tabEvals);
  await expect(page.getByRole("button", { name: s.evalStart })).toBeVisible();

  await switchIdentity(page, nonReviewer!.id);
  await expect(page.getByRole("button", { name: s.evalStart })).toHaveCount(0);
  await expect(tab(page, s.tabEvals)).toHaveCount(0);
  await expect(tab(page, s.tabQa)).toHaveAttribute("aria-current", "page");
});
