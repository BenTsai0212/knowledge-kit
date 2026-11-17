// 首頁「以前答不出來，現在可能答得出來了」（#408，docs/design.md「首頁」）：桌機 1440×900 與手機 390×844 各走一次
// 一般員工問一題被拒答 → 主管上傳相關文件並核准 → 一般員工回首頁看到 A2（問候下方一句話＋時間線）；問過的問題中同一題
// 只加小標示（#413）→ 按「再問一次」得到回答，之後首頁不再提示；按頂端的「知道了」，小標示一起消失。
// 拒答：本機檢索找不到段落時不呼叫模型；找到時假的 /api/ask 在核准前回 REFUSAL_MARKER，所以各客戶走同一條路。
// 主管的上傳與核准在桌機寬度進行（手機的待審收在「更多」）。展示模式不顯示首頁（presentation.spec.ts、sign-in.spec.ts）
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { REFUSAL_MARKER } from "../app/src/qa/prompt";
import { acceptButton, ACCESS_CODE, blockModelDownload, gotoView, s, switchIdentity, tab, uploadAndReview } from "./support/app";
import { NO_NON_REVIEWER, NO_REVIEWING_UPLOADER, nonReviewer, reviewingUploader } from "./support/client";
import { FAKE_ANSWER_LEAD, FAKE_ENTITY_NAME, routeFakeAsk, sseBody } from "./support/fake-ask";

const QUESTION = "員工停車證怎麼辦理？";
const TITLE = "E2E 停車證辦理";
const DESKTOP = { width: 1440, height: 900 };
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
// 元素的中心點最上層是它自己（或它的子元素）：在可見範圍內、沒有被 sticky 的輸入區或頂端列蓋住
const uncovered = (el: Locator) =>
  el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && node.contains(hit);
  });

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function openHome(page: Page): Promise<void> {
  expect(await gotoView(page, "home")).toBe(true);
  await expect(tab(page, s.tabHome)).toHaveAttribute("aria-current", "page");
}

// 一般員工問 QUESTION 被拒答 → 主管上傳一般員工看得到的相關文件並核准 → 一般員工回到首頁。回傳 A2 與問過的問題的區塊
async function refusedThenApproved(page: Page, viewport: { width: number; height: number }): Promise<{ recall: Locator; asked: Locator }> {
  await blockModelDownload(page);
  await routeFakeAsk(page);
  // 核准前的問答一律拒答（後註冊的 route 先處理），之後照常是假的回答
  let refuse = true;
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string };
    if (!refuse || !(body.system ?? "").startsWith("You answer questions")) return route.fallback();
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(REFUSAL_MARKER) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: s.signInWithCode }).click();
  await page.getByLabel(s.accessCodeLabel).fill(ACCESS_CODE);
  await page.getByRole("button", { name: s.accessCodeSubmit }).click();
  await expect(tab(page, s.tabHome)).toHaveAttribute("aria-current", "page");

  await switchIdentity(page, nonReviewer!.id);
  await page.getByPlaceholder(s.questionPlaceholder).fill(QUESTION);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  await expect(tab(page, s.tabQa)).toHaveAttribute("aria-current", "page");
  const answer = page.locator("section.answer").last();
  await expect(answer.getByText(s.answering)).toHaveCount(0);
  await expect(answer).not.toContainText(FAKE_ANSWER_LEAD);

  // 還沒有新的文件：不提示
  const recall = page.getByRole("region", { name: s.home.recallTitle });
  const asked = page.getByRole("region", { name: s.home.askedTitle });
  await openHome(page);
  await expect(asked.getByText(QUESTION)).toBeVisible();
  await expect(recall).toHaveCount(0);

  await page.setViewportSize(DESKTOP);
  await switchIdentity(page, reviewingUploader!.id);
  await uploadAndReview(page, { file: "parking-note.md", title: TITLE, visibility: nonReviewer!.visibility });
  const card = page.locator("section.review-doc").filter({ hasText: FAKE_ENTITY_NAME });
  await acceptButton(card).click();
  await expect(card).toHaveCount(0);
  refuse = false;
  await page.setViewportSize(viewport);

  await switchIdentity(page, nonReviewer!.id);
  await openHome(page);
  await expect(recall).toBeVisible();
  return { recall, asked };
}

for (const viewport of [DESKTOP, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });
    test.beforeEach(() => {
      test.skip(nonReviewer === undefined || reviewingUploader === undefined, nonReviewer === undefined ? NO_NON_REVIEWER : NO_REVIEWING_UPLOADER);
    });

    test("拒答 → 主管上傳並核准相關文件 → 首頁的 A1 與 A2 → 「再問一次」得到回答", async ({ page }, testInfo) => {
      const { recall, asked } = await refusedThenApproved(page, viewport);
      // A2：問候下方一句話、三點時間線（中間是帶來變化的文件）與「再問一次」
      await expect(recall).toContainText(QUESTION);
      await expect(recall.getByRole("list", { name: s.home.recallTimeline }).getByRole("listitem")).toHaveCount(3);
      await expect(recall.getByRole("button", { name: TITLE })).toBeVisible();
      await expect(recall.getByRole("button", { name: `${s.home.acknowledge}${s.colon}${QUESTION}` })).toBeVisible();
      // 問過的問題中同一題不重複（#413）：一般的列只多小標示，沒有「那時候」與「知道了」
      await expect(asked.locator(".home__row--maybe")).toHaveCount(0);
      await expect(asked.locator(".home__maybe-badge")).toHaveCount(1);
      await expect(asked.locator(".home__maybe-badge")).toHaveText(s.home.maybeBadge);
      await expect(asked.getByText(s.home.maybeThen.split("{")[0])).toHaveCount(0);
      await expect(asked.getByRole("button", { name: `${s.home.acknowledge}${s.colon}${QUESTION}` })).toHaveCount(0);
      await expect(asked.getByRole("button", { name: `${s.home.askAgain}${s.colon}${QUESTION}` })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      await screenshot(page, testInfo, `home-recheck-${viewport.width}`);

      // 「再問一次」得到回答；之後不再是拒答，首頁不再提示
      await recall.getByRole("button", { name: `${s.home.askAgain}${s.colon}${QUESTION}` }).click();
      await expect(tab(page, s.tabQa)).toHaveAttribute("aria-current", "page");
      await expect(page.locator("section.answer").last()).toContainText(FAKE_ANSWER_LEAD);
      // 捲到這一題的開頭（#411）：上方還有被拒答的那一題，新回答的標題在可見範圍內，不被輸入區或頂端列蓋住
      const heading = page.locator("section.answer").last().locator("h2");
      await expect(heading).toBeInViewport();
      await expect.poll(() => uncovered(heading)).toBe(true);
      await screenshot(page, testInfo, `home-recheck-again-${viewport.width}`);
      await openHome(page);
      await expect(asked.getByText(QUESTION)).toBeVisible();
      await expect(recall).toHaveCount(0);
      await expect(asked.locator(".home__maybe-badge")).toHaveCount(0);
    });

    test("「知道了」：按頂端的「知道了」，頂端與下方的小標示一起消失；資料沒有變化時回到首頁也不再提示", async ({ page }) => {
      const { recall, asked } = await refusedThenApproved(page, viewport);
      const badge = asked.locator(".home__maybe-badge");
      await expect(badge).toHaveCount(1);
      await recall.getByRole("button", { name: `${s.home.acknowledge}${s.colon}${QUESTION}` }).click();
      await expect(recall).toHaveCount(0);
      await expect(badge).toHaveCount(0);
      expect(await gotoView(page, "qa")).toBe(true);
      await openHome(page);
      await expect(asked.getByText(QUESTION)).toBeVisible();
      await expect(recall).toHaveCount(0);
    });
  });
}
