// 桌機的圖譜（#336，畫板 docs/design/v1/boards/Graph.dc.html、G-Scale.dc.html）：1440×900 時畫布至少 720px 高、
// 沒有選取時沒有實體欄（畫布佔滿寬度）、選取後實體欄貼齊右緣且是整個高度、相關實體是 52px 的列、縮放按鈕可用、沒有橫向捲動；
// 英文介面也不破版。截圖附在報告（graph-1440px.png、graph-en-1440px.png）。圖譜不呼叫模型
import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, s, switchIdentity, switchLanguage } from "./support/app";
import { client, reviewer } from "./support/client";
import { waitForGraphIdle, type Cy } from "./support/graph";

test.use({ viewport: { width: 1440, height: 900 } });

const CANVAS = ".graph-page .graph-canvas";
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const zoom = (page: Page) => page.evaluate((selector) => document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!._cyreg!.cy!.zoom(), CANVAS);

// 畫布中名稱不重複的第一個節點（以名稱搜尋）
async function uniqueNode(page: Page): Promise<string | null> {
  return page.evaluate((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!._cyreg!.cy!;
    const names = cy.nodes().map((n) => n.data("label"));
    return names.find((name) => names.filter((other) => other === name).length === 1) ?? null;
  }, CANVAS);
}

test("桌機 1440×900：畫布至少 720px、實體欄貼齊右緣、相關實體是列、縮放按鈕可用、沒有橫向捲動", async ({ page }, testInfo) => {
  await openApp(page);
  if (reviewer !== undefined) await switchIdentity(page, reviewer.id);
  await openTab(page, s.tabGraph);
  await waitForGraphIdle(page, CANVAS);

  // 沒有選取：沒有實體欄，畫布佔滿寬度；畫布高度填滿到視窗底部
  const stage = page.locator(".graph-stage");
  await expect(page.locator(".graph-entity-column")).toHaveCount(0);
  expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(720);
  expect(await noHorizontalScroll(page)).toBe(true);

  // 縮放按鈕：放大、縮小
  const before = await zoom(page);
  await page.getByRole("button", { name: s.graphZoomIn, exact: true }).click();
  await waitForGraphIdle(page, CANVAS);
  const zoomedIn = await zoom(page);
  expect(zoomedIn).toBeGreaterThan(before);
  await page.getByRole("button", { name: s.graphZoomOut, exact: true }).click();
  await waitForGraphIdle(page, CANVAS);
  expect(await zoom(page)).toBeLessThan(zoomedIn);

  // 以搜尋選取：實體欄貼齊右緣、整個高度
  const name = await uniqueNode(page);
  test.skip(name === null, "圖中沒有名稱不重複的節點");
  await page.getByRole("combobox", { name: s.graphSearch, exact: true }).fill(name!);
  await page.getByRole("option", { name: new RegExp(`^${escape(name!)} `) }).click();
  const column = page.locator(".graph-entity-column");
  await expect(column.getByRole("region", { name: name!, exact: true })).toBeVisible();
  await waitForGraphIdle(page, CANVAS);
  const box = (await column.boundingBox())!;
  expect(Math.abs(box.x + box.width - 1440)).toBeLessThan(1);
  expect(box.y).toBeLessThan(1);
  expect(Math.abs(box.height - 900)).toBeLessThan(1);
  // 相關實體是 52px 的列；點列的任何地方都從它展開
  const rows = column.locator(".entity-row");
  if ((await rows.count()) > 0) expect((await rows.first().boundingBox())!.height).toBeGreaterThanOrEqual(52);
  expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(720);
  expect(await noHorizontalScroll(page)).toBe(true);
  await testInfo.attach("graph-1440px.png", { body: await page.screenshot(), contentType: "image/png" });

  if ((await rows.count()) > 0) {
    const next = (await rows.first().locator("button").innerText()).trim();
    const row = (await rows.first().boundingBox())!;
    await page.mouse.click(row.x + row.width - 8, row.y + row.height / 2);
    await expect(column.getByRole("region", { name: next, exact: true })).toBeVisible();
  }

  // 英文介面：同樣不破版
  test.skip(!client.languages.includes("en"), "client.json 的 languages 沒有 en");
  await switchLanguage(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await waitForGraphIdle(page, CANVAS);
  await expect(page.locator(".graph-entity-column section.entity")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await testInfo.attach("graph-en-1440px.png", { body: await page.screenshot(), contentType: "image/png" });
});
