// 互動的邊角（#66）：上傳寫入中按 Esc、評測執行中離開頁籤、深色模式。/api/ask 一律是假的回應（support/fake-ask.ts）。
import { expect, test } from "@playwright/test";
import theme from "../client/theme.json" with { type: "json" };
import { openApp, openTab, s, switchIdentity } from "./support/app";

// #RRGGBB → getComputedStyle 的 rgb(r, g, b)
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

// 400 段的虛構文字：每段超過 chunk.ts 的短段落門檻，各自成為一段（上限是 parse.ts 的 MAX_PASSAGES）
const LONG_TEXT = Array.from({ length: 400 }, (_, i) => `Paragraph ${i + 1} of a fictional note used to make the upload write take longer.`).join("\n\n");

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("上傳寫入中按 Esc：視窗不關閉，寫入照常完成；完成後 Esc 可以關閉", async ({ page }) => {
  await switchIdentity(page, "manager");
  await openTab(page, s.tabUpload);
  // 寫入只在瀏覽器內的 PGlite 進行，很快就結束：以段落數多的虛構文字（一段寫入一列）並放慢 CPU（只有 Chromium 有 CDP），
  // 讓 Esc 落在寫入中
  await page.getByLabel(s.uploadDocTitle).fill("E2E long note");
  await page.getByLabel(s.uploadPaste).fill(LONG_TEXT);
  await page.getByRole("button", { name: s.uploadPreview }).click();
  const dialog = page.getByRole("dialog", { name: s.uploadConfirmTitle });
  await expect(dialog).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  await dialog.getByRole("button", { name: s.uploadSubmit, exact: true }).click();
  // 寫入已結束才看到時這裡失敗（不會默默通過），CI 會重試
  await expect(dialog.getByRole("button", { name: s.uploadWriting })).toBeVisible();
  await page.keyboard.press("Escape");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  await expect(dialog.getByText(s.uploadDone)).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("評測執行中離開頁籤再回來：顯示已停止，不停在執行中", async ({ page }) => {
  // 評測的第一個 /api/ask 停住不回，評測停在執行中；之後註冊的 route 優先
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let requests = 0;
  await page.route("**/api/ask", async (route) => {
    requests++;
    await held;
    await route.fallback().catch(() => {});
  });

  await switchIdentity(page, "manager");
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
