// 英文版面（#288，docs/design.md「英文版面」）：英文介面在 375px 與 1440px 寬度下各頁沒有橫向捲動，
// 截圖附在測試報告（CI 的 playwright-report）供人確認。圖譜的節點名稱最多兩行；待審頁分頁列超出時有右側的漸層提示。
// 以能審查的身分（看得到待審頁）切到英文；客戶沒有英文時略過
import { expect, test, type Page } from "@playwright/test";
import { gotoView, openApp, switchIdentity, switchLanguage } from "./support/app";
import { client, reviewingUploader, reviewer } from "./support/client";
import type { Cy } from "./support/graph";
import { waitForGraphIdle } from "./support/graph";
import type { View } from "../app/src/ui/online-demo";

const VIEWS: View[] = ["home", "qa", "graph", "timeline", "upload", "review"];
const hasEnglish = client.languages.includes("en");
const GRAPH_CANVAS = ".graph-page .graph-canvas";

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const width of [375, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 812 : 900 } });

    test("英文介面的各頁沒有橫向捲動", async ({ page }, testInfo) => {
      test.skip(!hasEnglish, "client.json 的 languages 沒有 en");
      const who = reviewingUploader ?? reviewer;
      test.skip(who === undefined, "access.json 沒有 canReview 的身分");
      await openApp(page);
      await switchIdentity(page, who!.id);
      await switchLanguage(page, "en");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");

      for (const view of VIEWS) {
        // 手機上主管的待審與時間軸收在「更多」（#255）
        if (!(await gotoView(page, view))) continue;
        if (view === "graph") await waitForGraphIdle(page, GRAPH_CANVAS);
        expect(await noHorizontalScroll(page), `${view} 沒有橫向捲動`).toBe(true);
        await testInfo.attach(`${view}-${width}px.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

        if (view === "graph") {
          // 畫在圖上的名稱最多兩行；完整名稱（label）不變
          const lines = await page.evaluate((selector) => {
            const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!._cyreg!.cy!;
            return cy.nodes().map((n) => n.data("shortLabel").split("\n").length);
          }, GRAPH_CANVAS);
          expect(Math.max(...lines)).toBeLessThanOrEqual(2);
        }
        if (view === "review") {
          // 分頁列放不下時可橫向捲動，右側有漸層提示
          const tabs = page.locator(".review-tabs");
          const overflow = await tabs.evaluate((el) => el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
          if (overflow) await expect(tabs).toHaveClass(/has-more/);
          else await expect(tabs).not.toHaveClass(/has-more/);
        }
      }
    });
  });
}
