// 手機版的時間軸、上傳、待審、評測台與更多（#282，docs/design.md「時間軸、上傳、待審、評測台與更多（手機）」）：375×812。
// 每一頁都檢查 375px 沒有橫向捲動、該頁新增的可點元件至少 44px（觸控目標）。橫向滑動的手感與 iOS 安全區由人在實機確認。
// /api/ask 一律是假的回應（openApp）。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { EVALS_PATH, field, gotoView, language, openApp, s, switchIdentity } from "./support/app";
import {
  client,
  NO_NON_REVIEWER,
  NO_REVIEWER,
  NO_REVIEWING_UPLOADER,
  NO_UPLOADER,
  nonReviewer,
  reviewer,
  reviewingUploader,
  uploader,
} from "./support/client";
import { twoCandidateNames } from "./support/dataset";
import { sseBody } from "./support/fake-ask";

test.use({ viewport: { width: 375, height: 812 } });

// 共用的檢查：整頁沒有橫向捲動；元件的高度與寬度都至少 44px
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function expectTouchTargets(targets: Locator): Promise<void> {
  const sizes = await targets.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.width, r.height]));
  expect(sizes.length).toBeGreaterThan(0);
  for (const [width, height] of sizes) {
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
}

const moreSheet = (page: Page) => page.locator("dialog.more-sheet");
const moreItems = (page: Page) => moreSheet(page).locator(".more-list button");

test.describe("時間軸", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    if (nonReviewer !== undefined) await switchIdentity(page, nonReviewer.id);
    expect(await gotoView(page, "timeline")).toBe(true);
    await expect(page.locator("ol.timeline > li").first()).toBeVisible();
  });

  test("日期欄 46px，卡片佔滿其餘寬度；沒有橫向捲動", async ({ page }) => {
    const first = page.locator("ol.timeline > li").first();
    expect((await first.locator(".timeline-date").boundingBox())!.width).toBeCloseTo(46, 0);
    const card = (await first.locator(".timeline-card").boundingBox())!;
    const row = (await first.boundingBox())!;
    expect(card.x + card.width).toBeCloseTo(row.x + row.width, 0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("篩選晶片一行、橫向滑動，觸控目標至少 44px；不符合的卡片變淡（45%），不移除", async ({ page }) => {
    const filter = page.locator(".timeline-filter");
    const chips = filter.locator("button.chip");
    await expect(chips.nth(1)).toBeVisible();
    // 一行：每個晶片的頂端都相同；晶片比可見寬度多時在晶片列內捲動，不撐開整頁
    const tops = await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await filter.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
    await expectTouchTargets(chips);
    expect(await noHorizontalScroll(page)).toBe(true);

    // 依序點晶片，直到有文件不符合；文件數不變，不符合的卡片 45% 不透明
    const rows = page.locator("ol.timeline > li");
    const total = await rows.count();
    const dimmed = page.locator("ol.timeline > li.dimmed");
    const count = await chips.count();
    for (let i = 1; i < count && (await dimmed.count()) === 0; i++) await chips.nth(i).click();
    await expect(dimmed.first()).toBeVisible();
    await expect(rows).toHaveCount(total);
    await expect.poll(() => dimmed.first().locator(".timeline-card").evaluate((el) => getComputedStyle(el).opacity)).toBe("0.45");
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe("上傳", () => {
  test.skip(uploader === undefined, NO_UPLOADER);

  test("五步縮成一條進度列，下方一行寫目前步驟；不在上傳頁時萃取結束，「上傳」分頁的小點亮起，回到上傳頁後消失", async ({ page }) => {
    await openApp(page);
    await switchIdentity(page, uploader!.id);
    expect(await gotoView(page, "upload")).toBe(true);
    const bar = page.locator(".upload-bar").first();
    await expect(bar.locator(".upload-bar__segment")).toHaveCount(5);
    await expect(page.locator(".upload-steps")).toHaveCount(0);
    await expect(bar.locator(".upload-bar__current")).toHaveText(s.uploadStepUpload);
    expect(await noHorizontalScroll(page)).toBe(true);

    // 萃取的回應先擋住，切到其他頁後才放行（route.fallback() 交給 openApp 的假回應）
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/ask", async (route) => {
      await held;
      await route.fallback();
    });
    await page.getByLabel(s.uploadFile).setInputFiles("e2e/fixtures/upload-note.md");
    await page.getByRole("button", { name: s.uploadPreview }).click();
    const dialog = page.getByRole("dialog", { name: s.uploadConfirmTitle });
    await dialog.getByRole("button", { name: s.uploadSubmit, exact: true }).click();
    await expect(dialog.getByText(s.uploadDone)).toBeVisible();
    // 萃取中：上傳與切段的段填滿，目前步驟是模型萃取與批次
    await expect(dialog.locator('.upload-bar__segment[data-step="chunk"]')).toHaveClass(/is-done/);
    await expect(dialog.locator('.upload-bar__segment[data-step="extract"]')).toHaveClass(/is-active/);
    await expect(dialog.locator(".upload-bar__current")).toContainText(s.uploadStepExtract);
    expect(await noHorizontalScroll(page)).toBe(true);
    await dialog.getByRole("button", { name: s.uploadAnother }).click();
    await expect(dialog).toBeHidden();

    const dot = page.locator('.mobile-tabbar [data-view="upload"] .tab-dot');
    await expect(dot).toHaveCount(0);
    expect(await gotoView(page, "qa")).toBe(true);
    release();
    await expect(dot).toBeVisible();
    expect(await gotoView(page, "upload")).toBe(true);
    await expect(dot).toHaveCount(0);
  });
});

test.describe("待審", () => {
  test.skip(reviewingUploader === undefined, NO_REVIEWING_UPLOADER);
  // 需要逐筆決定的實體：名稱的文件語言取自一個既有實體、其他語言取自同類型的另一個，合併時有兩個候選。
  // 萃取的寫入會捨棄缺少任一語言名稱的實體（extraction/output.ts 的 bad_names），所以「補上名稱」的摘要列無法經萃取產生，
  // 這裡用「選擇合併對象」走同一條摘要列與底部面板的路徑（sheetReason() 兩種原因的判斷在 review-helpers.test.ts）
  const candidate = reviewingUploader === undefined ? undefined : twoCandidateNames(reviewingUploader.id, client.languages, language);
  test.skip(candidate === undefined, "需要兩個看得到、類型相同的實體");

  test("分段切換一行、橫向捲動；需要選擇合併對象的實體只顯示摘要與「›」，點了以底部面板處理；「核准這份文件的全部」固定在下方", async ({ page }) => {
    const { type, names } = candidate!;
    const name = names[language];
    await openApp(page);
    await switchIdentity(page, reviewingUploader!.id);
    // 萃取結果是上面的實體（其他請求交給 openApp 的假回應）
    await page.route("**/api/ask", async (route) => {
      const body = route.request().postDataJSON() as { system?: string };
      if (!(body.system ?? "").startsWith("You extract entities")) return route.fallback();
      const entity = { key: "e1", type, names, sources: [1] };
      await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(JSON.stringify({ entities: [entity], relations: [] })) });
    });
    expect(await gotoView(page, "upload")).toBe(true);
    // 貼上內文含有實體名稱的文字
    await page.getByPlaceholder(s.uploadPastePlaceholder).fill(`${name} 負責檢查手機的待審頁。`);
    await field(page, s.uploadDocTitle, "input").fill("E2E mobile review note");
    await page.getByRole("button", { name: s.uploadPreview }).click();
    const upload = page.getByRole("dialog", { name: s.uploadConfirmTitle });
    await upload.getByRole("button", { name: s.uploadSubmit, exact: true }).click();
    await expect(upload.getByText(s.uploadDone)).toBeVisible();
    await upload.getByRole("button", { name: s.uploadAnother }).click();
    await expect(upload).toBeHidden();

    // 萃取在背景執行：到待審頁按重新整理，直到摘要列出現
    expect(await gotoView(page, "review")).toBe(true);
    const row = page.locator(".review-page--phone button.review-sheet-row").filter({ hasText: name });
    await expect(async () => {
      await page.getByRole("button", { name: s.reviewRefresh }).first().click();
      await expect(row).toBeVisible({ timeout: 2_000 });
    }).toPass();
    // has 在 section 之內找：不能用含外層 .review-page--phone 的 row
    const card = page.locator("section.review-doc").filter({ has: page.locator("button.review-sheet-row", { hasText: name }) });
    await expect(card).toHaveCount(1);
    await expect(row).toContainText(s.reviewSheetChoose);
    await expect(row).toContainText("›");
    // 名稱完整顯示，不以省略號截斷（空間不夠時是要做的決定換到下一行）
    const rowName = row.locator(".review-sheet-row__name");
    await expect(rowName).toHaveText(name);
    expect(await rowName.evaluate((el) => el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== "ellipsis")).toBe(true);
    // 列表上沒有合併選擇與核准按鈕：在底部面板中處理
    await expect(card.locator(".review-entity")).toHaveCount(0);

    // 分段切換：一行、在列內橫向捲動
    const tabs = page.locator(".review-tabs [role=tab]");
    const tops = await tabs.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await page.locator(".review-tabs").evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");

    // 「核准這份文件的全部」固定在分頁列之上，在可見範圍內；卡片頁首沒有這個按鈕
    const approveAll = card.locator(".review-doc__approve-all");
    expect(await approveAll.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    await expect(approveAll.getByRole("button", { name: s.reviewApproveDocument })).toBeInViewport();
    await expect(card.locator(".review-doc__side").getByRole("button", { name: s.reviewApproveDocument })).toHaveCount(0);
    await expectTouchTargets(page.locator(".review-tabs [role=tab], .review-toolbar .icon-button, button.review-sheet-row, .review-doc__approve-all > button"));
    expect(await noHorizontalScroll(page)).toBe(true);

    // 點摘要列打開底部面板：兩個候選與「建立新實體」，還沒選擇時不能確認；選「建立新實體」後確認，面板關閉、這份文件沒有遺留
    await row.click();
    const sheet = page.locator("dialog.review-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name })).toBeVisible();
    expect(await sheet.getByRole("radio").count()).toBeGreaterThanOrEqual(3);
    const confirm = sheet.getByRole("button", { name: new RegExp(`^${s.reviewConfirm}`) });
    await expect(confirm).toBeDisabled();
    await sheet.getByRole("radio", { name: s.reviewCreateNew, exact: true }).check();
    expect(await noHorizontalScroll(page)).toBe(true);
    await confirm.click();
    await expect(sheet).toBeHidden();
    await expect(page.locator(".toast-region")).toContainText(name);
    await expect(card).toHaveCount(0);
  });
});

test.describe("評測台", () => {
  test.skip(reviewer === undefined, NO_REVIEWER);

  test("設定收合成一列、指標兩欄、預設只列兩組不同的題目，點一題以底部面板查看；「下載品質報告」在最下方", async ({ page }) => {
    // 兩組設定各跑一次題庫（/api/ask 是假的回應）
    test.setTimeout(480_000);
    await openApp(page, EVALS_PATH);
    await switchIdentity(page, reviewer!.id);
    expect(await gotoView(page, "evals")).toBe(true);
    const evals = page.locator(".eval-page--phone");
    const setName = (name: string) => s.evalSetName.replace("{name}", name);

    // 設定收合成一列，欄位不在頁面上
    const settingsRow = evals.locator("button.eval-settings-row");
    await expect(settingsRow).toContainText(s.evalSettings);
    await expect(page.getByLabel(s.evalTopK).first()).toBeHidden();
    await expectTouchTargets(settingsRow);
    expect(await noHorizontalScroll(page)).toBe(true);

    // 點了以底部面板編輯：加上設定 B（topK 1），開始評測時面板關閉
    await settingsRow.click();
    const settings = page.locator("dialog.eval-settings-sheet");
    await expect(settings).toBeVisible();
    await settings.getByLabel(s.evalUseSetB).check();
    await settings.getByRole("group", { name: setName("B") }).getByLabel(s.evalTopK).fill("1");
    await expectTouchTargets(settings.locator(".eval-actions button"));
    await settings.getByRole("button", { name: s.evalStart, exact: true }).click();
    await expect(settings).toBeHidden();
    await expect(settingsRow).toContainText(s.evalSettingsBrief.replace("{name}", "B").replace("{topK}", "1"));
    const confirm = page.getByRole("dialog", { name: s.evalConfirmTitle });
    await confirm.getByRole("button", { name: s.evalConfirmStart, exact: true }).click();
    const report = evals.locator(".eval-report-footer > button");
    await expect(report).toHaveText(s.evalReport.download);
    await expect(report).toBeEnabled({ timeout: 420_000 });

    // 四項指標兩欄，附「✓ 通過（≥ 門檻）」或「✗ 未通過（…）」
    const metrics = evals.locator(".eval-metrics > li");
    await expect(metrics).toHaveCount(4);
    const boxes = await metrics.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.top)]));
    expect(new Set(boxes.map(([left]) => left)).size).toBe(2);
    expect(boxes[0][1]).toBe(boxes[1][1]);
    await expect(metrics.first().locator(".eval-verdict").first()).toContainText(/^[✓✗] /);

    // 390px 寬時四張指標卡在半個畫面內（約 420px），每個判定膠囊只有一行（文字的行框只有一個）
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(evals).toBeVisible();
    expect((await evals.locator(".eval-metrics").boundingBox())!.height).toBeLessThanOrEqual(420);
    const verdictLines = await evals.locator(".eval-metrics .eval-verdict").evaluateAll((els) =>
      els.map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      }),
    );
    expect(verdictLines.length).toBe(8);
    expect(verdictLines.every((lines) => lines === 1)).toBe(true);
    await page.setViewportSize({ width: 375, height: 812 });

    // 預設只列兩組不同的題目；取消勾選後列出全部
    const onlyDiff = evals.getByLabel(s.evalOnlyDiff);
    await expect(onlyDiff).toBeChecked();
    const rows = evals.locator("button.eval-question-row");
    const differing = await rows.count();
    if (differing === 0) await expect(evals.getByText(s.evalNoDiff)).toBeVisible();
    await onlyDiff.uncheck();
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    expect(await rows.count()).toBeGreaterThanOrEqual(differing);
    await expectTouchTargets(evals.locator("button.eval-question-row, .eval-results-card .eval-card-head label.inline, .eval-report-footer > button"));

    // 「下載品質報告」是頁面的最後一個元素（底部面板與對話框除外）
    expect(await evals.evaluate((el) => [...el.children].filter((c) => c.tagName !== "DIALOG").at(-1)?.classList.contains("eval-report-footer"))).toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);

    // 點一題以底部面板看兩組的回答與引用；關閉後回到列表
    await rows.first().click();
    const question = page.locator("dialog.eval-question-sheet");
    await expect(question).toBeVisible();
    await expect(question.getByRole("group", { name: setName("A") })).toBeVisible();
    await expect(question.getByRole("group", { name: setName("B") })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await question.getByRole("button", { name: s.dialogClose }).click();
    await expect(question).toBeHidden();
  });
});

test.describe("更多（主管）", () => {
  test.skip(reviewer === undefined, NO_REVIEWER);

  test("列出時間軸與待審，待審的數量（不是 0 時）標在清單上；沒有 ?tools=evals 時沒有評測台", async ({ page }) => {
    await openApp(page);
    await switchIdentity(page, reviewer!.id);
    await page.locator('.mobile-tabbar [data-view="more"]').click();
    await expect(moreSheet(page)).toBeVisible();
    expect(await moreItems(page).evaluateAll((bs) => bs.map((b) => b.getAttribute("data-view")))).toEqual(["timeline", "review"]);
    // 0 時不顯示（#358，mobile-timeline-uploads.spec.ts）；顯示時是正整數
    await expect(moreSheet(page).locator('[data-view="review"] .tab-count').filter({ hasText: /^0$/ })).toHaveCount(0);
    await expectTouchTargets(moreItems(page));
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("帶 ?tools=evals 時加上評測台", async ({ page }) => {
    await openApp(page, EVALS_PATH);
    await switchIdentity(page, reviewer!.id);
    await page.locator('.mobile-tabbar [data-view="more"]').click();
    expect(await moreItems(page).evaluateAll((bs) => bs.map((b) => b.getAttribute("data-view")))).toEqual(["timeline", "review", "evals"]);
    // 0 時不顯示（#358，mobile-timeline-uploads.spec.ts）；顯示時是正整數
    await expect(moreSheet(page).locator('[data-view="review"] .tab-count').filter({ hasText: /^0$/ })).toHaveCount(0);
  });
});

test("一般員工：分頁列沒有「更多」，時間軸在分頁列上", async ({ page }) => {
  test.skip(nonReviewer === undefined, NO_NON_REVIEWER);
  await openApp(page);
  await switchIdentity(page, nonReviewer!.id);
  await expect(page.locator('.mobile-tabbar [data-view="more"]')).toHaveCount(0);
  await expect(page.locator('.mobile-tabbar [data-view="timeline"]')).toBeVisible();
  await expectTouchTargets(page.locator(".mobile-tabbar button"));
});
