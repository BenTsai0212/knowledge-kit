// 身分與語言的身分卡片（#415）：不論說明長短、面板寬度或語言，圓點在左、名稱與可見範圍在右，同一列開始。
// 全域的 label 是 flex-wrap: wrap，說明較長的卡片曾經把文字區塊整塊換到圓點下一行。
// 桌機（1136，左側欄使用者卡打開的選單）、平板（820，右側滑出的面板）、手機（390，底部面板），中文與英文；截圖附在測試報告
import { expect, test, type Locator, type Page } from "@playwright/test";
import { identityBadge, identitySheet, openApp, switchLanguage } from "./support/app";
import { access, client, language } from "./support/client";

const VIEWPORTS = [
  { name: "desktop", width: 1136, height: 747 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "phone", width: 390, height: 844 },
];
const LANGUAGES = [...new Set([language, ...(client.languages.includes("en") ? ["en"] : [])])];

// 每張卡片的圓點與文字區塊：文字在圓點右側，頂端差距小於名稱的一行高
async function expectSameRow(cards: Locator): Promise<void> {
  const rows = await cards.evaluateAll((elements) =>
    elements.map((card) => {
      const dot = card.querySelector("input")!.getBoundingClientRect();
      const text = card.querySelector(".role-card__text")!.getBoundingClientRect();
      const lineHeight = card.querySelector(".role-card__name")!.getBoundingClientRect().height;
      return { name: card.querySelector(".role-card__name")!.textContent, dotTop: dot.top, dotRight: dot.right, textTop: text.top, textLeft: text.left, lineHeight };
    }),
  );
  expect(rows).toHaveLength(access.roles.length);
  for (const row of rows) {
    expect(row.textLeft, `${row.name}：文字在圓點右側`).toBeGreaterThanOrEqual(row.dotRight);
    expect(Math.abs(row.textTop - row.dotTop), `${row.name}：文字與圓點同一列`).toBeLessThan(row.lineHeight);
  }
}

async function openSheet(page: Page): Promise<Locator> {
  await identityBadge(page).click();
  const sheet = identitySheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".role-card")).toHaveCount(access.roles.length);
  return sheet;
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const code of LANGUAGES) {
      test(`身分卡片的圓點與文字在同一列（${code}）`, async ({ page }, testInfo) => {
        await openApp(page);
        if (code !== language) {
          await switchLanguage(page, code);
          await expect(page.locator("html")).toHaveAttribute("lang", code);
        }
        const sheet = await openSheet(page);
        await expectSameRow(sheet.locator(".role-card"));
        await testInfo.attach(`role-cards-${viewport.name}-${code}.png`, { body: await page.screenshot(), contentType: "image/png" });
      });
    }
  });
}
