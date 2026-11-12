// 問答的動態（#227，docs/design.md「動態」）：打開原文後，螢光刷過的段落在動畫結束時留著完整的螢光。
// 邀請碼錯誤（#246）：回到入口頁時保留已輸入的碼，邊線換成 danger、說明展開到完整高度（減少動態效果時直接到位）。
// Playwright 把透明的元素也當成可見，所以讀計算樣式。/api/ask 一律是假的回應。
import { expect, test, type Page } from "@playwright/test";
import { ACCESS_CODE, openApp, presetQuestions, s, sourcePanel, switchIdentity } from "./support/app";
import { FAKE_ANSWER_LEAD } from "./support/fake-ask";

const question = presetQuestions[0];

async function openSource(page: Page) {
  await openApp(page);
  await switchIdentity(page, question.role);
  await page.getByRole("button", { name: question.text, exact: true }).click();
  const answer = page.locator("section.answer");
  await expect(answer).toContainText(FAKE_ANSWER_LEAD);
  await answer.getByRole("button", { name: "1", exact: true }).click();
  const mark = sourcePanel(page).locator(".highlight mark");
  await expect(mark).toBeVisible();
  return mark;
}

// 背景色不透明，或有 background-image（刷過用的漸層）
const opaque = (style: { color: string; image: string }) => {
  const channels = style.color.match(/^rgba?\(([^)]*)\)$/)?.[1].split(/[\s,/]+/).filter(Boolean) ?? [];
  const solid = channels.length === 3 || (channels.length === 4 && Number(channels[3]) === 1);
  return solid || style.image !== "none";
};

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${reducedMotion}／${colorScheme}`, () => {
      test.use({ reducedMotion, colorScheme });

      test("打開原文，動畫結束後引用的段落是完整的螢光", async ({ page }) => {
        const mark = await openSource(page);
        const style = await mark.evaluate(async (el) => {
          await Promise.all(el.getAnimations().map((a) => a.finished));
          const css = getComputedStyle(el);
          return { color: css.backgroundColor, image: css.backgroundImage };
        });
        // 檢查本身：透明的背景會被抓到
        expect(opaque({ color: "rgba(0, 0, 0, 0)", image: "none" })).toBe(false);
        expect(opaque(style)).toBe(true);
        expect(style.color).not.toBe("rgba(0, 0, 0, 0)");
      });
    });
  }
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test.describe(`${reducedMotion}`, () => {
    test.use({ reducedMotion });

    test("邀請碼被拒：保留已輸入的碼，說明在輸入框下方展開到完整高度", async ({ page }) => {
      await openApp(page);
      await switchIdentity(page, question.role);
      // 後註冊的 route 先處理：這一題回 Worker 的 invalid_access_code
      await page.route("**/api/ask", (route) =>
        route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "invalid_access_code" }) }),
      );
      await page.getByRole("button", { name: question.text, exact: true }).click();
      const input = page.getByLabel(s.accessCodeLabel);
      await expect(input).toHaveValue(ACCESS_CODE);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      const error = page.getByText(s.errors.invalid_access_code);
      await expect(error).toBeVisible();
      const style = await error.evaluate(async (el) => {
        const box = el.parentElement!;
        await Promise.all(box.getAnimations().map((a) => a.finished));
        return { opacity: getComputedStyle(box).opacity, height: el.getBoundingClientRect().height, scroll: el.scrollHeight };
      });
      expect(style.opacity).toBe("1");
      expect(style.height).toBeGreaterThan(0);
      expect(style.height).toBeGreaterThanOrEqual(style.scroll - 1);
    });
  });
}
