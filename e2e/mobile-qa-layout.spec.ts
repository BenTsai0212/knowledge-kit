// 手機的問答版面（#256 PR 2，docs/design.md「問答（手機）」）：390×844 時預設問題一行、橫向滑動；
// 輸入框與提問按鈕固定在分頁列上方（捲動前後都是）；引用標號高至少 24px、觸控範圍 44px；「回答提到」一行；
// 問答頁頂部的「這次的問題（N）」打開底部面板，點一題就捲到該題（#256 決定 1）。每一步都檢查整頁沒有橫向捲動。
// safe area 與動態的觀感由人在實機確認。/api/ask 一律是假的回應（openApp() 的 routeFakeAsk）。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, presetQuestions, s } from "./support/app";

test.use({ viewport: { width: 390, height: 844 } });

const composer = (page: Page) => page.locator("section.composer");
const tabBar = (page: Page) => page.locator(".mobile-tabbar");
const answers = (page: Page) => page.locator("section.answer");
const sessionButton = (page: Page) => page.locator(".session-questions-button");
const sessionSheet = (page: Page) => page.locator("dialog.session-questions-sheet");
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (el: Locator) => (await el.boundingBox())!;

// 以輸入框提問，等這一題回答完
async function ask(page: Page, question: string): Promise<Locator> {
  await page.getByPlaceholder(s.questionPlaceholder).fill(question);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  const answer = answers(page).last();
  await expect(answer.getByRole("heading", { name: question })).toBeVisible();
  await expect(answer.getByText(s.answering)).toHaveCount(0);
  return answer;
}

// 輸入區的底邊貼齊分頁列的頂邊
async function expectComposerOnTabBar(page: Page) {
  const bar = await box(tabBar(page));
  const input = await box(composer(page));
  expect(Math.abs(input.y + input.height - bar.y)).toBeLessThanOrEqual(1);
}

// 一行：所有元素的垂直中心相同（徽章、晶片、按鈕的高度不同，置中對齊）
async function expectOneLine(items: Locator) {
  const centers = await items.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => r.top + r.height / 2));
  expect(centers.length).toBeGreaterThan(0);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(2);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("預設問題一行、橫向滑動；輸入區在提問前後、捲到頂與捲到底時都固定在分頁列上方，最後一題不被蓋住", async ({ page }) => {
  const presets = page.locator(".presets");
  await expectOneLine(presets.getByRole("button"));
  expect(await presets.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
  if (presetQuestions.length > 1) expect(await presets.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expectComposerOnTabBar(page);
  expect(await noHorizontalScroll(page)).toBe(true);

  for (const question of [presetQuestions[0].text, "第二題", "第三題"]) await ask(page, question);
  await expectComposerOnTabBar(page);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expectComposerOnTabBar(page);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expectComposerOnTabBar(page);
  const last = await box(answers(page).last());
  expect(last.y + last.height).toBeLessThanOrEqual((await box(composer(page))).y + 1);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("引用標號高至少 24px，觸控範圍補到 44px；「回答提到」一行、橫向滑動", async ({ page }) => {
  const answer = await ask(page, presetQuestions[0].text);
  const citation = answer.locator("button.citation").first();
  await expect(citation).toBeVisible();
  await citation.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const b = await box(citation);
  expect(b.height).toBeGreaterThanOrEqual(24);
  // 標號中心上下左右 20px（44px 的範圍內）點下去仍是這個標號
  const hits = await citation.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    return [
      [x, y - 20],
      [x, y + 20],
      [x - 20, y],
      [x + 20, y],
    ].map(([px, py]) => document.elementFromPoint(px, py)?.closest("button.citation") === el);
  });
  expect(hits).toEqual([true, true, true, true]);

  // 「回答提到」只在回答提到實體時出現（依各客戶的資料）
  const mentions = answer.getByRole("group", { name: s.answerMentions });
  if ((await mentions.count()) === 0) {
    test.info().annotations.push({ type: "skip-part", description: "這一題的回答沒有提到實體，略過「回答提到」的檢查" });
  } else {
    await expectOneLine(mentions.locator(":scope > p, .mention-group > *"));
    expect(await mentions.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
  }
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("「這次的問題（N）」：沒有提問時不顯示；打開底部面板列出問題，點一題就關閉面板並捲到該題", async ({ page }) => {
  await expect(sessionButton(page)).toHaveCount(0);
  const questions = [presetQuestions[0].text, "第二題", "第三題"];
  for (const question of questions) await ask(page, question);
  await expect(sessionButton(page)).toHaveText(s.sessionQuestionsCount.replace("{count}", String(questions.length)));

  // 從頁面頂部打開，選最後一題：關閉面板後焦點回到按鈕，但畫面要停在選的那一題
  await page.evaluate(() => window.scrollTo(0, 0));
  await sessionButton(page).click();
  const sheet = sessionSheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: s.sessionQuestions })).toBeVisible();
  await expect(sheet.getByRole("listitem")).toHaveText(questions);
  expect(await noHorizontalScroll(page)).toBe(true);

  await sheet.getByRole("button", { name: questions[2], exact: true }).click();
  await expect(sheet).toBeHidden();
  const heading = answers(page).nth(2).getByRole("heading", { name: questions[2] });
  await expect(async () => {
    const top = await box(page.locator(".mobile-topbar"));
    const h = await box(heading);
    // 不被 sticky 的頂端列與輸入區蓋住
    expect(h.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
    expect(h.y + h.height).toBeLessThanOrEqual((await box(composer(page))).y + 1);
  }).toPass();
  expect(await noHorizontalScroll(page)).toBe(true);
});
