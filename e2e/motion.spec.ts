// 問答的動態（#227，docs/design.md「動態」）：打開原文後，螢光刷過的段落在動畫結束時留著完整的螢光。
// Playwright 把透明的元素也當成可見，所以讀計算樣式。/api/ask 一律是假的回應。
import { expect, test, type Page } from "@playwright/test";
import { openApp, presetQuestions, sourcePanel, switchIdentity } from "./support/app";
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
