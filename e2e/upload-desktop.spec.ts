// 桌機的上傳頁（#344，畫板 docs/design/v1/boards/K-Uploads.dc.html、B-Ingest.dc.html）：1440×900 時頁首是 h1 與分段切換
// （「我的上傳 N」的 N 是還在處理中的上傳數），內容填滿寬度；送出後是四步進度卡；我的上傳每份一列，點一列在右側打開上傳詳情，
// 「看原文」的實體以類型色底線標出。每一步檢查沒有橫向捲動，截圖附在測試報告（CI 的 E2E artifact）。萃取是假的回應（support/fake-ask.ts）
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { field, gotoView, openApp, openTab, s, switchIdentity, switchLanguage, upload } from "./support/app";
import { client, knowledgeModel, NO_UPLOADER, uploader } from "./support/client";
import { FAKE_ENTITY_NAME } from "./support/fake-ask";

const WIDTH = 1440;
const HEIGHT = 900;
test.use({ viewport: { width: WIDTH, height: HEIGHT } });

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (el: Locator) => (await el.boundingBox())!;
const tokenColor = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--color-${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
// #RRGGBB → getComputedStyle 的 rgb(r, g, b)
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

test("頁首與分段切換、送出後的四步進度卡、我的上傳的列與右側的上傳詳情照畫板", async ({ page }, testInfo) => {
  test.skip(uploader === undefined, NO_UPLOADER);
  const title = "E2E desktop upload";
  await openApp(page);
  await switchIdentity(page, uploader!.id);
  await openTab(page, s.tabUpload);

  // 頁首：h1 28px，同一列是分段切換；內容填滿寬度（不再是最寬 960px 的卡片）
  const main = page.locator(".upload-main");
  const heading = main.getByRole("heading", { level: 1, name: s.tabUpload });
  await expect(heading).toHaveCSS("font-size", "28px");
  const tabs = main.getByRole("tablist", { name: s.myUploads.sections });
  const newTab = tabs.getByRole("tab", { name: s.myUploads.tabNew });
  const mineTab = tabs.getByRole("tab", { name: s.myUploads.tabMine });
  await expect(newTab).toHaveAttribute("aria-selected", "true");
  // 還沒有上傳：沒有數字
  await expect(mineTab).toHaveText(s.myUploads.tabMine);
  const headingBox = await box(heading);
  const tabsBox = await box(tabs);
  expect(tabsBox.y).toBeLessThan(headingBox.y + headingBox.height);
  expect((await box(main.locator(".drop-zone"))).width).toBeGreaterThan(960);
  // 提示是 surfaceRaised 底的說明列
  await expect(main.locator(".upload-hint")).toHaveCSS("background-color", await tokenColor(page, "surfaceRaised"));
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "upload-new-1440.png");

  // 貼上含假萃取實體名稱的文字後送出
  await page.getByPlaceholder(s.uploadPastePlaceholder).fill(`${FAKE_ENTITY_NAME} 負責檢查桌機的上傳頁。`);
  await field(page, s.uploadDocTitle, "input").fill(title);
  await page.getByRole("button", { name: s.uploadPreview }).click();
  const dialog = page.getByRole("dialog", { name: s.uploadConfirmTitle });
  await dialog.getByRole("button", { name: s.uploadSubmit, exact: true }).click();

  // 送出後的進度卡：「已送出〈標題〉」與四步；萃取完成後目前的步驟是「等主管審核」（primary），之前的步驟是 success
  const card = dialog.getByRole("region", { name: s.myUploads.submitted.replace("{title}", title) });
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS("border-top-color", await tokenColor(page, "primary"));
  const steps = card.locator(".upload-step");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(2)).toHaveAttribute("aria-current", "step");
  const bar = (i: number) => steps.nth(i).evaluate((el) => getComputedStyle(el, "::before").backgroundColor);
  const success = await tokenColor(page, "success");
  expect(await bar(0)).toBe(success);
  expect(await bar(1)).toBe(success);
  expect(await bar(2)).toBe(await tokenColor(page, "primary"));
  expect(await bar(3)).toBe(await tokenColor(page, "border"));
  await screenshot(page, testInfo, "upload-submitted-1440.png");
  await dialog.getByRole("button", { name: s.uploadAnother }).click();
  await expect(dialog).toBeHidden();

  // 分段切換的數字：自己還在處理中的上傳數
  await expect(mineTab).toHaveText(`${s.myUploads.tabMine} 1`);
  await mineTab.click();
  await expect(mineTab).toHaveAttribute("aria-selected", "true");

  // 我的上傳：每份一列（surfaceRaised 底、圓角 12px），文件日期 mono 12px，狀態膠囊（審核中）
  const row = main.locator(".my-upload").filter({ hasText: title });
  await expect(row).toHaveCSS("background-color", await tokenColor(page, "surfaceRaised"));
  await expect(row).toHaveCSS("border-radius", "12px");
  await expect(row.locator(".my-upload__date")).toHaveCSS("font-size", "12px");
  await expect(row.locator(".badge")).toHaveText(s.myUploads.statusInReview);
  await expect(row.locator(".badge")).toHaveCSS("color", await tokenColor(page, "primary"));

  // 點一列：右側的上傳詳情（貼齊右緣），每組萃取結果一列
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  const detail = page.getByRole("complementary", { name: title });
  await expect(detail.getByText(s.myUploads.detail, { exact: true })).toBeVisible();
  const detailBox = await box(detail);
  expect(detailBox.x + detailBox.width).toBeGreaterThan(WIDTH - 20);
  expect(detailBox.x).toBeGreaterThan((await box(row)).x + (await box(row)).width);
  await expect(detail.locator(".upload-detail__items li").filter({ hasText: FAKE_ENTITY_NAME })).toContainText(s.myUploads.statusInReview);

  // 萃取完成後（#344 審查）：一句摘要與目前狀態的說明，不顯示萃取與比對的處理紀錄
  const summary = detail.locator(".upload-detail__summary");
  await expect(summary).toContainText(s.myUploads.extractSummary.split("{entities}")[0]);
  await expect(summary).toContainText(s.myUploads.noteInReview);
  await expect(detail.locator(".extraction")).toHaveCount(0);
  await expect(detail).not.toContainText(s.extractDone);
  await expect(detail).not.toContainText(s.conflictUnrelated);

  // 看原文：實體以類型色的 3px 底線標出
  await detail.getByRole("button", { name: s.myUploads.viewSource }).click();
  const source = detail.getByRole("region", { name: s.sourceTitle });
  const entity = source.locator(".upload-entity").filter({ hasText: FAKE_ENTITY_NAME }).first();
  await expect(entity).toBeVisible();
  await expect(entity).toHaveCSS("border-bottom-width", "3px");
  await expect(entity).toHaveCSS("border-bottom-color", rgb(knowledgeModel.entityTypes[0].color));
  await expect(detail.getByRole("button", { name: s.myUploads.hideSource })).toHaveAttribute("aria-expanded", "true");
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "upload-detail-1440.png");

  // 回到新增文件時不顯示詳情
  await newTab.click();
  await expect(detail).toHaveCount(0);
});

test("英文版面：頁首、我的上傳與上傳詳情不破版", async ({ page }, testInfo) => {
  test.skip(!client.languages.includes("en"), "client.json 的 languages 沒有 en");
  test.skip(uploader === undefined, NO_UPLOADER);
  await openApp(page);
  await switchIdentity(page, uploader!.id);
  await upload(page, { title: "E2E desktop upload (English layout)" });
  await switchLanguage(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await gotoView(page, "upload");

  const main = page.locator(".upload-main");
  const heading = main.getByRole("heading", { level: 1 });
  const tabs = main.getByRole("tablist");
  expect((await box(tabs)).y).toBeLessThan((await box(heading)).y + (await box(heading)).height);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "upload-new-1440-en.png");

  await tabs.getByRole("tab").nth(1).click();
  const row = main.locator(".my-upload").first();
  await row.click();
  const detail = page.locator(".upload-detail");
  await expect(detail).toBeVisible();
  // 列與詳情的內容不超出
  for (const el of [row, detail]) expect(await el.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "upload-detail-1440-en.png");
});
