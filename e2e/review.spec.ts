// 待審頁（#189）：以走查用的通知（fixtures/walkthrough-notice.md，虛構）檢查系統先準備、只把需要確認的交給審核者。
// 萃取是假的 /api/ask（support/fake-ask.ts 的 WALKTHROUGH）；合併與圖譜已有以參考情境的圖譜為準，其他客戶略過
import { expect, test } from "@playwright/test";
import { openApp, s, switchIdentity, uploadAndReview } from "./support/app";
import { clientName, reviewingUploader } from "./support/client";
import { WALKTHROUGH_TITLE } from "./support/fake-ask";

const fill = (template: string, values: Record<string, number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));

test.use({ viewport: { width: 1280, height: 720 } });

test("走查用的通知：第一個畫面看得到摘要、進度與需要確認的組，核准全部後沒有遺留", async ({ page }) => {
  test.skip(clientName !== "", "走查用的通知依參考情境的知識模型與圖譜（client/）");
  await openApp(page);
  // 參考情境的主管：能上傳也能審查
  await switchIdentity(page, reviewingUploader!.id);
  await uploadAndReview(page, { file: "walkthrough-notice.md", title: WALKTHROUGH_TITLE, visibility: "internal", expected: "陳柏翰" });

  const card = page.locator("section.review-doc").filter({ hasText: WALKTHROUGH_TITLE });
  const summary = card.getByText(fill(s.reviewSummary, { entities: 1, relations: 2, merged: 4, existing: 4 }));
  const progress = card.getByText(fill(s.reviewProgress, { count: 1 }));
  const chen = card.getByText("陳柏翰", { exact: true }).first();
  const approveAll = card.getByRole("button", { name: s.reviewApproveDocument });
  // 系統已準備收合成一行，合併的可見範圍提示在收合時也看得到
  const prepared = card.locator("details.review-prepared > summary");
  for (const item of [summary, progress, chen, card.getByText(s.reviewNew, { exact: true }), approveAll, prepared]) {
    await expect(item).toBeInViewport();
  }
  await expect(prepared).toContainText(fill(s.reviewPrepared, { count: 8 }));
  await expect(prepared).toContainText(s.reviewPreparedMergeHint);
  // 沒有需要選擇合併對象的組，按鈕旁沒有「還有 N 組需要你決定」
  await expect(card.getByText(s.reviewNeedsChoice)).toHaveCount(0);

  // 展開後每筆一行：4 個系統建議、4 段圖譜已有
  await prepared.click();
  await expect(card.getByText(s.reviewSuggested, { exact: true })).toHaveCount(4);
  await expect(card.getByText(s.reviewExisting, { exact: true })).toHaveCount(4);

  await approveAll.click();
  await expect(page.getByRole("status")).toContainText(fill(s.reviewToastApproved, { count: 11 }));
  // 這份文件沒有遺留待審：卡片消失
  await expect(card).toHaveCount(0);
});
