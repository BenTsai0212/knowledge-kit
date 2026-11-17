// 待審頁的只審接縫（ADR 0011，#378 PR 4c，畫板 docs/design/v1/boards/S-Review.dc.html）：參考情境的 review.mode 是 seams。
// 上傳只審接縫的試用紀錄（fixtures/seam-notice.md，虛構；萃取是假的 /api/ask，support/fake-ask.ts 的 SEAM）：林志明（兩個候選）
// 與張雅亭（與張雅婷只差一個字）是接縫，其餘 3 項直接收錄。依參考情境的圖譜，其他客戶略過；逐筆核准（item）的待審頁由
// clients/ 的示範客戶執行（review-desktop.spec.ts、mobile-pages.spec.ts、retract.spec.ts）。截圖附在測試報告（seam-*.png）
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { openApp, s, seams, switchIdentity, uploadAndReview } from "./support/app";
import { clientName, reviewingUploader } from "./support/client";
import { SEAM_TITLE } from "./support/fake-ask";

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
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
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

// 以主管（能上傳也能審查）上傳試用紀錄，等接縫與「已直接收錄」都出現（直接收錄在萃取完成後才寫入，按重新整理再讀）。
// 上傳與等待在桌機寬度進行（手機的待審收在「更多」），之後才換成 viewport 的寬度
async function setup(page: Page, viewport = { width: 1440, height: 900 }) {
  test.skip(clientName !== "", "只審接縫的試用紀錄依參考情境的圖譜（client/）");
  test.skip(!seams, "參考情境的 client.json 應為 review.mode: seams");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await switchIdentity(page, reviewingUploader!.id);
  await uploadAndReview(page, { file: "seam-notice.md", title: SEAM_TITLE, visibility: "internal", expected: "林志明" });
  const card = page.locator("section.review-doc").filter({ hasText: SEAM_TITLE });
  const auto = card.locator(".review-auto");
  await expect(async () => {
    await page.getByRole("button", { name: s.reviewRefresh }).first().click();
    await expect(auto).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await page.setViewportSize(viewport);
  const asks = card.locator(".review-seams .ask-card");
  const lin = asks.filter({ hasText: fill(s.seamAskCandidates, { count: 2, name: "林志明" }) });
  const yating = asks.filter({ hasText: fill(s.seamAskNear, { name: "張雅亭", other: "張雅婷" }) });
  return { card, auto, asks, lin, yating };
}

for (const [label, width, height] of [["桌機 1440", 1440, 900], ["手機 390", 390, 844]] as const) {
  test.describe(label, () => {
    test("接縫是 AI 在問你的卡片、照畫板的外觀；其餘在「已直接收錄」，預設收合", async ({ page }, testInfo) => {
      const { card, auto, asks, lin, yating } = await setup(page, { width, height });
      await expect(page.locator(width < 600 ? ".review-page--phone" : ".review-page--desktop")).toBeVisible();
      await expect(asks).toHaveCount(2);
      await expect(lin).toHaveCount(1);
      await expect(yating).toHaveCount(1);

      // 跟著林志明一起決定的關係：只有文字（小標與關係），沒有自己的按鈕
      const rel = lin.locator(".ask-card__rel");
      await expect(rel).toContainText(s.seamRelations);
      await expect(rel).toContainText("林志明");
      await expect(rel.getByRole("button")).toHaveCount(0);

      // 項目本身（S-Review ①，#400）：surfaceRaised 底的方塊，類型膠囊（色點＋類型名稱）、粗體名稱、「出處（N）」文字連結
      const item = lin.locator(".ask-card__item");
      await expect(item).toHaveCSS("background-color", await tokenColor(page, "surfaceRaised"));
      await expect(item.locator(".ask-card__kind .type-dot")).toBeVisible();
      await expect(item.locator(".ask-card__kind")).toHaveText(/\S/);
      await expect(item.locator("strong")).toHaveText("林志明");
      const sources = item.locator("button.ask-card__sources");
      await expect(sources).toContainText(s.reviewSources.split("{count}")[0]);
      await expect(sources).toHaveCSS("border-top-width", "0px");
      await expect(sources).toHaveCSS("text-decoration-line", "underline");
      await expect(sources).toHaveCSS("color", await tokenColor(page, "primary"));

      // 選項（兩個候選、我覺得是新的、都不是）：至少 44px、14px、一般字重；出口是 textMuted
      const options = lin.locator(".refusal-ask__options button");
      await expect(options).toHaveCount(4);
      for (const option of await options.all()) {
        expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(option).toHaveCSS("font-size", "14px");
        await expect(option).toHaveCSS("font-weight", "400");
      }
      await expect(lin.getByRole("button", { name: s.commonExplain })).toHaveCSS("color", await tokenColor(page, "textMuted"));
      // 接縫卡直接放在文件卡的列表中，外面沒有多一層框線與內距（手機，#400；桌機原本就沒有）
      for (const item of await card.locator(".review-seams > li").all()) {
        await expect(item).toHaveCSS("border-top-width", "0px");
        await expect(item).toHaveCSS("padding-left", "0px");
      }

      // 已直接收錄：預設收合（標題、說明與兩個按鈕，沒有列）
      await expect(auto.locator(".review-auto__title")).toContainText(fill(s.seamAutoSection, { count: 3 }));
      await expect(auto.locator(".review-auto__item")).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      await screenshot(page, testInfo, `seam-review-${width}px.png`);

      // 「都不是，我來說明」：說明欄的標題靠左（與輸入框左緣對齊）
      await lin.getByRole("button", { name: s.commonExplain }).click();
      const explain = lin.locator(".ask-card__explain label");
      await expect(explain).toHaveCSS("align-items", "stretch");
      const [textLeft, boxLeft] = await explain.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild!);
        return [range.getBoundingClientRect().left, el.querySelector("textarea")!.getBoundingClientRect().left];
      });
      expect(Math.abs(textLeft - boxLeft)).toBeLessThanOrEqual(1);
      await screenshot(page, testInfo, `seam-explain-${width}px.png`);

      // 展開全部：3 列，每列有撤回
      await auto.getByRole("button", { name: s.seamAutoShowAll }).click();
      await expect(auto.locator(".review-auto__item")).toHaveCount(3);
      await expect(auto.getByRole("button", { name: s.seamAutoRetract, exact: true })).toHaveCount(3);
      // 實體的列顯示類型名稱，不留下空膠囊（S-Review ⑥，#400）
      await expect(auto.locator(".entity-badge__label").first()).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      await screenshot(page, testInfo, `seam-auto-${width}px.png`);
    });
  });
}

test("選了候選、寫了說明之後接縫消失；抽查 3 項，撤回關係時選理由，標示「已撤回：〈理由〉」", async ({ page }, testInfo) => {
  const { card, auto, asks, lin, yating } = await setup(page);

  // 林志明：選第一個候選，和跟著它的關係一起核准
  await lin.locator(".refusal-ask__options button").first().click();
  await expect(lin).toHaveCount(0);

  // 張雅亭：都不是，我來說明 → AI 以固定句型複述 → 對，記錄下來
  const note = "名單上的張雅亭是新來的同事";
  await yating.getByRole("button", { name: s.commonExplain }).click();
  await yating.getByRole("textbox").fill(note);
  await yating.getByRole("button", { name: s.commonExplainSubmit }).click();
  await expect(yating).toContainText(fill(s.commonRestate, { note }));
  await yating.getByRole("button", { name: s.commonRestateYes }).click();
  await expect(asks).toHaveCount(0);

  // 抽查：直接收錄只有 3 項，全部列出
  await auto.getByRole("button", { name: fill(s.seamAutoSample, { count: 3 }) }).click();
  await expect(auto.locator(".review-auto__item")).toHaveCount(3);

  // 撤回關係（測試人員甲 —參與→ 青翼專案）：理由必選，選了才能按撤回
  const row = auto.locator(".review-auto__item").filter({ has: page.locator(".review-relation__type") });
  await row.getByRole("button", { name: s.seamAutoRetract, exact: true }).click();
  const confirm = row.locator(".review-auto__confirm").getByRole("button", { name: s.seamAutoRetract, exact: true });
  await expect(confirm).toBeDisabled();
  await row.getByRole("button", { name: s.seamReasonRelation }).click();
  await expect(row.getByRole("button", { name: s.seamReasonRelation })).toHaveAttribute("aria-pressed", "true");
  await confirm.click();
  await expect(page.getByRole("status")).toContainText(s.seamAutoToast);

  // 撤回的項目留在清單中、標示理由；標題的數字跟著變
  await expect(row).toContainText(`${s.seamAutoRetracted}${s.colon}${s.seamReasonRelation}`);
  await expect(auto.locator(".review-auto__title")).toContainText(fill(s.seamAutoSection, { count: 2 }));
  await expect(auto.locator(".review-auto__title")).toContainText(fill(s.seamAutoRetractedCount, { count: 1 }));
  await expect(card).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "seam-retracted-1440px.png");

  // 撤回後回到待審的關係（#400）：和其他接縫同樣是「問你」的卡片與選項，不是逐筆核准的列（沒有「退回」「核准這份文件的全部」）
  await expect(asks).toHaveCount(1);
  await expect(asks.locator(".refusal-ask__question")).toContainText(s.seamAskOther.split("{name}")[0]);
  for (const name of [s.seamOptionKeep, s.seamOptionExclude, s.commonExplain]) await expect(asks.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: s.reviewReject, exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: s.reviewApproveDocument })).toHaveCount(0);
  // 項目本身是關係的名稱與「出處（N）」文字連結，不是外框按鈕（S-Review ①）
  const relationSources = asks.locator(".ask-card__item button.ask-card__sources");
  await expect(relationSources).toHaveCSS("border-top-width", "0px");
  await expect(relationSources).toHaveCSS("text-decoration-line", "underline");
  await asks.scrollIntoViewIfNeeded();
  await screenshot(page, testInfo, "seam-retracted-pending-1440px.png");

  // 手機 390：同樣的卡片，直接放在文件卡的列表中（外面沒有框線與內距）
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".review-page--phone")).toBeVisible();
  await expect(asks).toHaveCount(1);
  const item = card.locator(".review-seams > li").first();
  await expect(item).toHaveCSS("border-top-width", "0px");
  await expect(item).toHaveCSS("padding-left", "0px");
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "seam-retracted-pending-390px.png");
});
