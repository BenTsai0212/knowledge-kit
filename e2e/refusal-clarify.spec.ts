// 拒答時先確認要找的是哪一種（#377，docs/design.md「先確認要找的是哪一種」）：桌機 1440×900、手機 390×844、平板 820×1180 各走一次
// 「拒答 → 選一項 → 看到泡泡與下一步」與「略過 → 現行清單」；選項的觸控目標至少 44px，每一步都沒有橫向捲動，截圖附在測試報告。
// 回答、未附出處的回答與錯誤不出現選項。「資料沒寫」與「看不到的段落」相同由 access.spec.ts 檢查。/api/ask 一律是假的回應
import { expect, test, type Locator, type Page, type Route, type TestInfo } from "@playwright/test";
import { REFUSAL_MARKER } from "../app/src/qa/prompt";
import { openApp, presetQuestions, s, switchIdentity } from "./support/app";
import { FAKE_ANSWER_LEAD, sseBody } from "./support/fake-ask";

const question = presetQuestions[0];
const OPTIONS = [s.refusalClarifyPolicy, s.refusalClarifyPersonal, s.refusalClarifyPeople];
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (el: Locator) => (await el.boundingBox())!;
const sse = (text: string) => ({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(text) });
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

// 問答的請求以 respond 回應（其他請求照常是假的回應）；每次提問是新的一題，回傳最新一題
async function setUp(page: Page, respond: (route: Route) => Promise<void>) {
  await openApp(page);
  await switchIdentity(page, question.role);
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string };
    if (!(body.system ?? "").startsWith("You answer questions")) return route.fallback();
    return respond(route);
  });
}

async function ask(page: Page): Promise<Locator> {
  await page.getByPlaceholder(s.questionPlaceholder).fill(question.text);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  const answer = page.locator("section.answer").last();
  await expect(answer.getByText(s.answering)).toHaveCount(0);
  return answer;
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("拒答 → 選一項 → 使用者的泡泡與一句下一步；略過 → 現行的「可以試試」", async ({ page }, testInfo) => {
      await setUp(page, (route) => route.fulfill(sse(REFUSAL_MARKER)));

      // 拒答文字之後問一次：小標、提問、三個選項＋略過、「輪到你」；還沒有「可以試試」
      let answer = await ask(page);
      const refusal = answer.locator(".refusal");
      await expect(refusal.locator(".answer-text")).toHaveText(s.refusal);
      const card = refusal.getByRole("group", { name: s.refusalClarifyTitle });
      await expect(card.getByText(s.refusalClarifyQuestion)).toBeVisible();
      await expect(card.getByRole("button")).toHaveText([...OPTIONS, s.refusalClarifySkip]);
      await expect(card.getByText(s.refusalClarifyYourTurn)).toBeVisible();
      await expect(refusal.locator(".refusal-next")).toHaveCount(0);
      // 外觀：左側 mark 色粗邊、白底；選項至少 44px 高
      await expect(card).toHaveCSS("border-left-color", await tokenColor(page, "mark"));
      await expect(card).toHaveCSS("background-color", await tokenColor(page, "surface"));
      for (const button of await card.getByRole("button").all()) expect((await box(button)).height).toBeGreaterThanOrEqual(44);
      if (viewport.name === "phone") {
        // 手機：可以換行的膠囊
        await expect(card.getByRole("button").first()).toHaveCSS("border-radius", /^(999|[1-9]\d{2,})px$/);
      }
      expect(await noHorizontalScroll(page)).toBe(true);
      await screenshot(page, testInfo, `refusal-clarify-${viewport.name}-ask`);

      // 選一項：選項收起，選擇是右側的深色泡泡（與問題泡泡相同的顏色），下方接一句下一步；焦點在下一步
      await card.getByRole("button", { name: s.refusalClarifyPeople, exact: true }).click();
      await expect(card).toHaveCount(0);
      const chosen = refusal.locator(".refusal-chosen");
      const bubble = chosen.locator(".refusal-chosen__choice");
      await expect(bubble).toHaveText(s.refusalClarifyPeople);
      await expect(bubble).toHaveCSS("background-color", await tokenColor(page, "text"));
      await expect(bubble).toHaveCSS("color", await tokenColor(page, "background"));
      const bubbleBox = await box(bubble);
      const refusalBox = await box(refusal);
      expect(Math.abs(bubbleBox.x + bubbleBox.width - (refusalBox.x + refusalBox.width))).toBeLessThanOrEqual(24);
      await expect(chosen.locator(".refusal-chosen__next")).not.toBeEmpty();
      await expect(chosen).toBeFocused();
      await expect(refusal.locator(".refusal-next")).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      await screenshot(page, testInfo, `refusal-clarify-${viewport.name}-chosen`);

      // 略過（新的一題）：現行的「可以試試」清單
      answer = await ask(page);
      await answer.getByRole("button", { name: s.refusalClarifySkip, exact: true }).click();
      await expect(answer.locator(".refusal-ask")).toHaveCount(0);
      await expect(answer.locator(".refusal-chosen")).toHaveCount(0);
      await expect(answer.locator(".refusal-next").getByText(s.refusalNextTitle)).toBeVisible();
      expect(await answer.locator(".refusal-next li").count()).toBeGreaterThanOrEqual(2);
      expect(await noHorizontalScroll(page)).toBe(true);
      await screenshot(page, testInfo, `refusal-clarify-${viewport.name}-skip`);
    });
  });
}

test("回答、未附出處的回答與錯誤不出現選項", async ({ page }) => {
  let reply: (route: Route) => Promise<void> = (route) => route.fulfill(sse(`${FAKE_ANSWER_LEAD} [1]。`));
  await setUp(page, (route) => reply(route));

  let answer = await ask(page);
  await expect(answer.locator("button.citation").first()).toBeVisible();
  await expect(answer.locator(".refusal-ask, .refusal-chosen, .refusal-next")).toHaveCount(0);

  reply = (route) => route.fulfill(sse(FAKE_ANSWER_LEAD));
  answer = await ask(page);
  await expect(answer.getByText(s.uncited)).toBeVisible();
  await expect(answer.locator(".refusal-ask, .refusal-chosen, .refusal-next")).toHaveCount(0);

  reply = (route) => route.abort("internetdisconnected");
  answer = await ask(page);
  await expect(answer.locator(".problem")).toContainText(s.errors.network);
  await expect(answer.locator(".refusal-ask, .refusal-chosen, .refusal-next")).toHaveCount(0);
});
