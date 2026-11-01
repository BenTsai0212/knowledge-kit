// 冒煙測試（#66）：各頁籤能打開並完成基本操作。/api/ask 一律是假的回應（support/fake-ask.ts）。
import { expect, test } from "@playwright/test";
import { openApp, openTab, presetQuestions, s, sourcePanel, switchIdentity } from "./support/app";
import { NO_REVIEWER, NO_REVIEWING_UPLOADER, reviewer, reviewingUploader } from "./support/client";
import { FAKE_ANSWER_LEAD, FAKE_ENTITY_NAME } from "./support/fake-ask";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("問答：回答附出處，點出處打開原文", async ({ page }) => {
  const question = presetQuestions[0];
  await switchIdentity(page, question.role);
  await page.getByRole("button", { name: question.text, exact: true }).click();

  const answer = page.locator("section.answer");
  await expect(answer).toContainText(FAKE_ANSWER_LEAD);
  await answer.getByRole("button", { name: "1", exact: true }).click();
  await expect(sourcePanel(page)).toBeVisible();
  await expect(sourcePanel(page).locator("mark")).toBeVisible();
});

// 用能審查的身分中看得最多的；沒有時用預設身分（第一個）
test("圖譜：畫出畫布，點節點打開實體面板", async ({ page }) => {
  if (reviewer !== undefined) await switchIdentity(page, reviewer.id);
  await openTab(page, s.tabGraph);
  const canvas = page.locator(".graph-canvas");
  await expect(canvas.locator("canvas").first()).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();

  // cytoscape 把實例放在容器的 _cyreg；取第一個節點在畫面上的位置後以滑鼠點擊。
  // 版面計算完成前位置可能還會變，整段讀取與點擊一起重試
  await expect(async () => {
    const node = await page.evaluate(() => {
      type Cy = { nodes(): { length: number; [i: number]: { renderedPosition(): { x: number; y: number }; data(key: string): string } } };
      const container = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(".graph-canvas");
      const nodes = container?._cyreg?.cy?.nodes();
      if (container == null || nodes === undefined || nodes.length === 0) return null;
      const box = container.getBoundingClientRect();
      const position = nodes[0].renderedPosition();
      return { x: box.left + position.x, y: box.top + position.y, label: nodes[0].data("label") };
    });
    expect(node).not.toBeNull();
    await page.mouse.click(node!.x, node!.y);
    await expect(page.getByRole("region", { name: node!.label })).toBeVisible({ timeout: 2_000 });
  }).toPass();
});

test("時間軸：列出文件，打開原文", async ({ page }) => {
  await openTab(page, s.tabTimeline);
  const first = page.locator("ol.timeline > li").first();
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: s.openSource }).first().click();
  await expect(sourcePanel(page)).toBeVisible();
});

test("上傳與待審：上傳 Markdown，萃取的實體出現在待審", async ({ page }) => {
  test.skip(reviewingUploader === undefined, NO_REVIEWING_UPLOADER);
  await switchIdentity(page, reviewingUploader!.id);
  await openTab(page, s.tabUpload);
  await page.getByLabel(s.uploadFile).setInputFiles("e2e/fixtures/upload-note.md");
  await page.getByRole("button", { name: s.uploadPreview }).click();

  const dialog = page.getByRole("dialog", { name: s.uploadConfirmTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: s.uploadSubmit, exact: true }).click();
  await expect(dialog.getByText(s.uploadDone)).toBeVisible();
  await dialog.getByRole("button", { name: s.uploadAnother }).click();
  await expect(dialog).toBeHidden();

  // 萃取在背景執行；結束前打開待審頁時看不到，按重新整理再讀一次
  await openTab(page, s.tabReview);
  const item = page.getByRole("checkbox", { name: FAKE_ENTITY_NAME });
  await expect(async () => {
    await page.getByRole("button", { name: s.reviewRefresh }).first().click();
    await expect(item).toBeVisible({ timeout: 2_000 });
  }).toPass();
});

test("評測台：估算後執行到完成", async ({ page }) => {
  test.skip(reviewer === undefined, NO_REVIEWER);
  await switchIdentity(page, reviewer!.id);
  await openTab(page, s.tabEvals);
  await page.getByRole("button", { name: s.evalStart }).click();
  const dialog = page.getByRole("dialog", { name: s.evalConfirmTitle });
  await dialog.getByRole("button", { name: s.evalConfirmStart, exact: true }).click();
  await expect(page.getByText(s.evalDone)).toBeVisible({ timeout: 120_000 });
});
