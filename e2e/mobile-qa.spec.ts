// 手機的問答與原文面板（#256，docs/design.md「問答（手機）」）：390×844 時點引用標號，原文從底部面板升起（高 74%），
// 標題列是「出處 N／M」與上一個、下一個（44px）；原文在 reading 紙面、引用段落用 markReading；下方「回報有錯」。
// 每一步都檢查整頁沒有橫向捲動。往下拖曳的手感、safe area 與動態的觀感由人在實機確認。/api/ask 一律是假的回應。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, presetQuestions, s, switchIdentity } from "./support/app";
import { FAKE_ANSWER_LEAD, sseBody } from "./support/fake-ask";

test.use({ viewport: { width: 390, height: 844 } });

const answers = (page: Page) => page.locator("section.answer");
const sheet = (page: Page) => page.locator("dialog.source-sheet");
const stepTitle = (n: number, total: number) => s.sourceStep.replace("{n}", String(n)).replace("{total}", String(total));
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
// 等面板與螢光的動態結束（進場、刷過）再量
const settle = (el: Locator) => el.evaluate(async (node) => void (await Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished))));
// CSS 變數的計算後顏色（與元素的 getComputedStyle 同一種格式）
const tokenColor = (page: Page, name: string) =>
  page.evaluate((token) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${token})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, name);

// 問答的回答依序引用 prompt 中的每一段（[1][2]…[k]），所以引用標號的數量等於檢索到的段落數；
// prompt 中每段只出現一次（app/src/qa/prompt.ts 的 groups()），「出處 N／M」的 M 就是 k。其他請求交給 openApp() 的假回應。
// 回傳一個函式：取得最近一次問答請求的段落數
async function routeCitingAnswer(page: Page): Promise<() => number> {
  let passages = 0;
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string; messages?: { content: string }[] };
    if (!(body.system ?? "").startsWith("You answer questions")) return route.fallback();
    passages = (body.messages?.[0]?.content.match(/<passage number="/g) ?? []).length;
    const citations = Array.from({ length: passages }, (_, i) => `[${i + 1}]`).join("");
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(`${FAKE_ANSWER_LEAD} ${citations}。`) });
  });
  return () => passages;
}

// 不假設某一題一定檢索到 2 段（各客戶的資料與身分不同）：依序以預設問題的身分提問，
// 找到檢索到至少 2 個不同段落的那一題；回傳該題的回答與段落數，三份資料都可能找不到時回 null
async function askWithSeveralSources(page: Page): Promise<{ answer: Locator; total: number } | null> {
  const passages = await routeCitingAnswer(page);
  for (const question of presetQuestions) {
    await switchIdentity(page, question.role);
    await page.getByPlaceholder(s.questionPlaceholder).fill(question.text);
    await page.getByRole("button", { name: s.askButton, exact: true }).click();
    const answer = answers(page).last();
    await expect(answer.getByRole("heading", { name: question.text })).toBeVisible();
    await expect(answer.getByText(s.answering)).toHaveCount(0);
    const total = passages();
    if (total < 2) continue;
    await expect(answer).toContainText(FAKE_ANSWER_LEAD);
    await expect(answer.locator("button.citation")).toHaveCount(total);
    return { answer, total };
  }
  return null;
}

let answer: Locator;
let total: number;

test.beforeEach(async ({ page }) => {
  await openApp(page);
  const found = await askWithSeveralSources(page);
  test.skip(found === null, "預設問題都只檢索到 0 或 1 段，無法測試出處之間的切換");
  ({ answer, total } = found!);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("點引用標號 → 原文從底部面板升起（74%）、引用段落有螢光 → 下一個出處 → 按關閉、往下拖都會關閉", async ({ page }) => {
  const citations = answer.locator("button.citation");
  await citations.nth(0).click();
  const panel = sheet(page);
  await expect(panel).toBeVisible();
  await expect(page.locator("aside.source")).toHaveCount(0);
  await settle(panel);
  await expect(panel.getByRole("heading", { name: stepTitle(1, total) })).toBeVisible();
  expect((await panel.boundingBox())!.height / 844).toBeCloseTo(0.74, 2);
  // 底部面板貼齊視窗底部
  const box = (await panel.boundingBox())!;
  expect(box.y + box.height).toBeCloseTo(844, 0);

  // 原文在 reading 紙面，引用段落用 markReading
  const mark = panel.locator(".highlight mark");
  await expect(mark).toBeVisible();
  expect(await panel.locator(".source-text").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenColor(page, "--color-reading"));
  expect(await mark.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenColor(page, "--color-markReading"));
  const first = await mark.textContent();

  // 上一個、下一個是 44px；第一個沒有上一個
  const prev = panel.getByRole("button", { name: s.sourcePrev, exact: true });
  const next = panel.getByRole("button", { name: s.sourceNext, exact: true });
  await expect(prev).toBeDisabled();
  for (const button of [prev, next]) {
    const b = (await button.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }
  expect(await noHorizontalScroll(page)).toBe(true);

  await next.click();
  await expect(panel.getByRole("heading", { name: stepTitle(2, total) })).toBeVisible();
  if (total === 2) await expect(next).toBeDisabled();
  else await expect(next).toBeEnabled();
  await expect(prev).toBeEnabled();
  await expect(citations.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator(".highlight mark")).toBeVisible();
  expect(await panel.locator(".highlight mark").textContent()).not.toBe(first);
  expect(await noHorizontalScroll(page)).toBe(true);

  // 按關閉：焦點回到引用標號
  await panel.getByRole("button", { name: s.dialogClose, exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(citations.nth(0)).toBeFocused();

  // 再打開一次，從把手往下拖超過門檻
  await citations.nth(0).click();
  await expect(panel).toBeVisible();
  await settle(panel);
  const grip = (await panel.locator(".bottom-sheet__handle").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect(panel).toBeHidden();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("原文面板的「回報有錯」：關閉面板，打開這一題的回報表單", async ({ page }) => {
  await answer.locator("button.citation").first().click();
  const panel = sheet(page);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: s.reportButton, exact: true }).click();
  await expect(panel).toBeHidden();
  const form = answer.getByRole("form", { name: s.reportButton });
  await expect(form).toBeVisible();
  await expect(form.locator("select")).toBeFocused();
  expect(await noHorizontalScroll(page)).toBe(true);
});
