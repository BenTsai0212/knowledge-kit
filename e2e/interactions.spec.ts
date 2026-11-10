// 互動的邊角（#66）：上傳寫入中按 Esc、評測執行中離開頁籤、深色模式。/api/ask 一律是假的回應（support/fake-ask.ts）。
import { expect, test } from "@playwright/test";
import { EVALS_PATH, openApp, openTab, s, switchIdentity } from "./support/app";
import { NO_REVIEWER, NO_UPLOADER, reviewer, theme, uploader } from "./support/client";

// #RRGGBB → getComputedStyle 的 rgb(r, g, b)
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

// 評測執行中離開頁籤的測試要用評測台，以開啟評測台的網址打開
test.beforeEach(async ({ page }) => {
  await openApp(page, EVALS_PATH);
});

test("上傳寫入中按 Esc：寫入不中斷、只寫入一次；完成後 Esc 可以關閉", async ({ page }) => {
  test.skip(uploader === undefined, NO_UPLOADER);
  await switchIdentity(page, uploader!.id);
  await openTab(page, s.tabUpload);
  await page.getByLabel(s.uploadFile).setInputFiles("e2e/fixtures/upload-note.md");
  await page.getByRole("button", { name: s.uploadPreview }).click();
  const dialog = page.getByRole("dialog", { name: s.uploadConfirmTitle });
  await expect(dialog).toBeVisible();

  // PGlite 在主執行緒執行：寫入期間瀏覽器不處理按鍵，也無法從外部看到「上傳中」的狀態（放慢 CPU 或加長文件都一樣）。
  // 所以按下上傳後立刻按 Esc，按鍵排在寫入之後處理；視窗可能顯示完成，也可能已被這次 Esc 關閉
  await dialog.getByRole("button", { name: s.uploadSubmit, exact: true }).click();
  await page.keyboard.press("Escape");
  const done = dialog.getByText(s.uploadDone);
  await expect(async () => expect((await dialog.isHidden()) || (await done.isVisible())).toBe(true)).toPass({ timeout: 30_000 });
  if (await dialog.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }

  // 寫入完成且只有一份
  await openTab(page, s.tabTimeline);
  const uploaded = page.locator("ol.timeline > li").filter({ has: page.locator(".badge").getByText(s.timelineUploaded, { exact: true }) });
  await expect(uploaded).toHaveCount(1);
  await expect(uploaded).toContainText("upload-note");
});

test("評測執行中離開頁籤再回來：顯示已停止，不停在執行中", async ({ page }) => {
  test.skip(reviewer === undefined, NO_REVIEWER);
  // 評測的第一個 /api/ask 停住不回，評測停在執行中；之後註冊的 route 優先
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let requests = 0;
  await page.route("**/api/ask", async (route) => {
    requests++;
    await held;
    await route.fallback().catch(() => {});
  });

  await switchIdentity(page, reviewer!.id);
  await openTab(page, s.tabEvals);
  await page.getByRole("button", { name: s.evalStart }).click();
  const dialog = page.getByRole("dialog", { name: s.evalConfirmTitle });
  await dialog.getByRole("button", { name: s.evalConfirmStart, exact: true }).click();
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(page.getByText(s.evalRunning)).toBeVisible();

  await openTab(page, s.tabQa);
  await expect(page.getByRole("button", { name: s.evalStop, exact: true })).toHaveCount(0);
  await openTab(page, s.tabEvals);
  await expect(page.getByText(s.evalStopped)).toBeVisible();
  await expect(page.getByText(s.evalAborted)).toBeVisible();
  await expect(page.getByText(s.evalRunning)).toHaveCount(0);
  await expect(page.getByRole("button", { name: s.evalStart })).toBeEnabled();

  release();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("深色模式：依 prefers-color-scheme 切換配色，切回淺色時恢復", async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(background).toBe(rgb(theme.colors.background));
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe(rgb(theme.darkColors.background));
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).color)).toBe(rgb(theme.darkColors.text));
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(background).toBe(rgb(theme.colors.background));
});
