// README 的截圖（#369）：桌機 1440×900 的各頁與 390×844 的手機，介面語言各一套，寫到 docs/images/<名稱>-<語言>.png。
// 不是測試，預設不執行：KK_README_SHOTS=1 時 playwright.config.ts 只執行這個檔案（重新產生的方式見 docs/testing.md「README 的截圖」）。
// /api/ask 一律是假的回應（routeFakeAsk，另以 page.route 讓問答的回答取自檢索到的段落），不需要 API 金鑰、不呼叫模型；
// 以邀請碼登入，截圖中沒有登入頁、邀請碼與帳號；只用參考情境（client/）的虛構資料，Light 模式、減少動態效果
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { EVALS_PATH, gotoView, openApp, switchIdentity, switchLanguage, uploadAndReview } from "./support/app";
import { client, reviewingUploader, s as defaultStrings, scenarios, stringsFor } from "./support/client";
import { SEAM_TITLE, sseBody } from "./support/fake-ask";
import { clickNodeOnce, waitForGraphIdle, type Cy } from "./support/graph";

type Strings = typeof defaultStrings;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const CANVAS = ".graph-page .graph-canvas";
const shotPath = (name: string, lang: string) => `docs/images/${name}-${lang}.png`;

test.use({ colorScheme: "light", reducedMotion: "reduce" });

// 主管總覽的第一題（參考情境：「長堤專案目前的進度如何？」）；沒有時用第一個預設問題
const question = (() => {
  const scenario = scenarios.scenarios.find((x) => x.role === reviewingUploader?.id) ?? scenarios.scenarios[0];
  return { role: scenario.role, text: scenario.questions[0].text };
})();

const unescape = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// 問答的回答：取 prompt 中與介面同語言的前兩段（沒有時取前兩段）原文並引用，讓截圖中的回答與出處對得上。其他請求交給 openApp() 的假回應
async function routeQuotingAnswer(page: Page, lang: string): Promise<void> {
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string; messages?: { content: string }[] };
    if (!(body.system ?? "").startsWith("You answer questions")) return route.fallback();
    const passages = [...(body.messages?.[0]?.content ?? "").matchAll(/<passage number="(\d+)"[^>]*language="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g)].map(
      ([, number, language, text]) => ({ number, language, text: unescape(text) }),
    );
    const same = passages.filter((p) => p.language === lang);
    const quoted = (same.length > 0 ? same : passages).slice(0, 2);
    const text = quoted.map((p) => `${p.text} [${p.number}]`).join(" ");
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(text) });
  });
}

// 以邀請碼登入、切到主管（能上傳也能審核的身分）與指定的語言；回傳該語言的介面文字
async function start(page: Page, lang: string, path = "/"): Promise<Strings> {
  await openApp(page, path);
  await routeQuotingAnswer(page, lang);
  await switchIdentity(page, reviewingUploader!.id);
  return lang === client.defaultLanguage ? defaultStrings : stringsFor(lang);
}

async function useLanguage(page: Page, lang: string): Promise<void> {
  if (lang === client.defaultLanguage) return;
  await switchLanguage(page, lang);
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
}

// 在問答頁提問，等回答完成
async function ask(page: Page, t: Strings, lang: string): Promise<void> {
  await page.getByPlaceholder(t.questionPlaceholder).fill(question.text[lang]);
  await page.getByRole("button", { name: t.askButton, exact: true }).click();
  await waitForAnswer(page, t);
}

async function waitForAnswer(page: Page, t: Strings): Promise<void> {
  const answer = page.locator("section.answer").last();
  await expect(answer.getByText(t.answering)).toHaveCount(0);
  await expect(answer.locator("button.citation").first()).toBeVisible();
}

// 關聯最多的節點（同數時取第一個）
const mostConnected = (page: Page) =>
  page.evaluate((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!._cyreg!.cy!;
    const degree = (id: string) => cy.$id(id).neighborhood("node").map((n) => n.id()).length;
    return cy.nodes().map((n) => n.id()).reduce((best, id) => (degree(id) > degree(best) ? id : best));
  }, CANVAS);

async function selectHub(page: Page): Promise<void> {
  await gotoView(page, "graph");
  await waitForGraphIdle(page, CANVAS);
  await clickNodeOnce(page, CANVAS, await mostConnected(page));
  await waitForGraphIdle(page, CANVAS);
}

async function closeSource(page: Page, t: Strings): Promise<void> {
  const source = page.getByRole("complementary", { name: t.sourceTitle });
  await source.getByRole("button", { name: t.closeSource, exact: true }).click();
  await expect(source).toHaveCount(0);
}

const shoot = (page: Page, name: string, lang: string) => page.screenshot({ path: shotPath(name, lang) });

for (const lang of client.languages) {
  test.describe(lang, () => {
    test.beforeEach(() => {
      test.skip(reviewingUploader === undefined, "access.json 沒有同時 canUpload 與 canReview 的身分");
    });

    test.describe("桌機", () => {
      test.use({ viewport: DESKTOP });

      test("首頁、問答、圖譜、時間軸、我的上傳、待審", async ({ page }) => {
        test.setTimeout(300_000);
        const t = await start(page, lang);
        // 先以預設語言上傳只審接縫的試用紀錄（兩個接縫與已直接收錄），待審、我的上傳與首頁的「等你處理」才有內容
        await uploadAndReview(page, { file: "seam-notice.md", title: SEAM_TITLE, visibility: "internal", expected: "林志明" });
        await useLanguage(page, lang);

        await gotoView(page, "home");
        await shoot(page, "home", lang);

        await gotoView(page, "qa");
        await ask(page, t, lang);
        await page.locator("section.answer button.citation").first().click();
        await expect(page.getByRole("complementary", { name: t.sourceTitle })).toBeVisible();
        await shoot(page, "qa", lang);
        // 原文欄換頁後仍開著：關閉，圖譜的畫布與我的上傳才不會被擠窄（#372 修正要求）
        await closeSource(page, t);

        await selectHub(page);
        await shoot(page, "graph", lang);

        await gotoView(page, "timeline");
        await expect(page.locator(".timeline-card").first()).toBeVisible();
        await shoot(page, "timeline", lang);

        await gotoView(page, "upload");
        await page.getByRole("tab", { name: new RegExp(`^${t.myUploads.tabMine}`) }).click();
        await page.locator(".my-upload").first().click();
        await expect(page.locator(".upload-detail__summary")).toBeVisible();
        await expect(page.locator(".upload-source")).toHaveCount(0);
        await shoot(page, "uploads", lang);

        await gotoView(page, "review");
        await expect(page.locator("section.review-doc").first()).toBeVisible();
        await shoot(page, "review", lang);
      });

      test("評測台與品質報告（?tools=evals）", async ({ page }) => {
        test.setTimeout(420_000);
        const t = await start(page, lang, EVALS_PATH);
        await useLanguage(page, lang);
        await gotoView(page, "evals");
        const actions = page.locator(".eval-actions button");
        await actions.nth(0).click();
        await page.getByRole("dialog", { name: t.evalConfirmTitle }).getByRole("button", { name: t.evalConfirmStart, exact: true }).click();
        await expect(actions.nth(2)).toBeEnabled({ timeout: 360_000 });
        await page.locator("tr.eval-row td.eval-number").first().click();
        await expect(page.locator("tr.eval-detail")).toHaveCount(1);
        await shoot(page, "evals", lang);

        const download = page.waitForEvent("download");
        await actions.nth(2).click();
        await page.setContent(readFileSync((await (await download).path())!, "utf8"));
        await expect(page.locator("section.page").first()).toBeVisible();
        await shoot(page, "report", lang);
      });

      test("展示模式（?mode=presentation）", async ({ page }) => {
        const t = await start(page, lang, "/?mode=presentation");
        await useLanguage(page, lang);
        // 展示模式以劇本的題目提問
        await page.getByRole("button", { name: question.text[lang], exact: true }).click();
        // 不打開原文：浮在右側的原文卡片會蓋住回答（#372 修正要求），截圖留回答、身分對照與題目清單
        await waitForAnswer(page, t);
        await expect(page.getByRole("complementary", { name: t.sourceTitle })).toHaveCount(0);
        await shoot(page, "presentation", lang);
      });
    });

    test.describe("手機", () => {
      test.use({ viewport: MOBILE });

      test("首頁、問答、圖譜", async ({ page }) => {
        test.setTimeout(180_000);
        const t = await start(page, lang);
        await useLanguage(page, lang);
        await gotoView(page, "home");
        await shoot(page, "mobile-home", lang);

        await gotoView(page, "qa");
        await ask(page, t, lang);
        await shoot(page, "mobile-qa", lang);

        await selectHub(page);
        await shoot(page, "mobile-graph", lang);
      });
    });
  });
}

