// 手機的圖譜與實體面板對齊設計稿（#357，畫板 docs/design/v1/boards/G-Mobile-Graph.dc.html 第 2、3 張）：390×844 時上方一列是搜尋框
// （沒有看得到的標籤，placeholder「搜尋名稱」）＋篩選圖示按鈕，下一列是「圖譜｜清單」的分段切換；畫布不套卡片、填滿到分頁列上方，
// 右下是看得到的實體與關係數（#247）。選取後實體面板停在約一半高，類型膠囊、名稱與「關聯 N · 文件 N」同一列，「在問答中問」「只看它」等寬，
// 相關實體每則一列；選取的節點在畫布可見的上半部。觸控目標至少 44px，每一步都沒有橫向捲動。截圖附在測試報告（CI 的 E2E artifact）。
// 圖譜不呼叫模型；/api/ask 一律是假的回應
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openApp, openTab, s } from "./support/app";
import { access } from "./support/client";
import { visibleGraph } from "./support/dataset";
import { waitForGraphIdle, type Cy } from "./support/graph";

test.use({ viewport: { width: 390, height: 844 } });

const CANVAS = ".graph-page .graph-canvas";
const entitySheet = (page: Page) => page.locator("dialog.entity-sheet");
const search = (page: Page) => page.getByRole("combobox", { name: s.graphSearch, exact: true });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (el: Locator) => (await el.boundingBox())!;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

// 看得到的按鈕都至少 44×44px（相關實體的列：名稱按鈕的 ::after 蓋住整列，量列的高度）
async function expectTouchTargets(scope: Locator) {
  for (const button of await scope.locator("button:not(.entity-row button)").all()) {
    if (!(await button.isVisible())) continue;
    const b = await box(button);
    expect(Math.min(b.width, b.height), await button.innerText()).toBeGreaterThanOrEqual(44);
  }
  for (const row of await scope.locator(".entity-row").all()) if (await row.isVisible()) expect((await box(row)).height).toBeGreaterThanOrEqual(44);
}

// 進場動畫與高度的 transition 播完為止
async function settle(el: Locator) {
  await expect.poll(() => el.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
}

async function openGraph(page: Page): Promise<void> {
  await openApp(page);
  await openTab(page, s.tabGraph);
  await waitForGraphIdle(page, CANVAS);
}

// 畫布中名稱不重複的第一個節點（以名稱搜尋）
async function uniqueNode(page: Page): Promise<{ id: string; name: string } | null> {
  return page.evaluate((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!._cyreg!.cy!;
    const nodes = cy.nodes().map((n) => ({ id: n.id(), name: n.data("label") as string }));
    return nodes.find((n) => nodes.filter((m) => m.name === n.name).length === 1) ?? null;
  }, CANVAS);
}

test("上方是搜尋框＋篩選圖示按鈕與分段切換，沒有搜尋標籤；畫布填滿到分頁列，右下是看得到的實體與關係數", async ({ page }, testInfo) => {
  await openGraph(page);
  const main = page.locator(".graph-page .graph-main");
  // 搜尋框：標籤只給報讀器（1px），placeholder 是「搜尋名稱」
  const label = main.locator(".graph-tools label", { hasText: s.graphSearch });
  await expect(label).toHaveCount(1);
  expect((await box(label)).width).toBeLessThanOrEqual(1);
  await expect(search(page)).toHaveAttribute("placeholder", s.graphSearch);
  // 篩選按鈕在搜尋框右側同一列，只有圖示（名稱是 aria-label）
  const filters = page.getByRole("button", { name: s.graphFilters });
  await expect(filters).toHaveText("");
  const [field, button] = [await box(search(page)), await box(filters)];
  expect(Math.abs(field.y + field.height / 2 - (button.y + button.height / 2))).toBeLessThan(2);
  expect(button.x).toBeGreaterThan(field.x + field.width - 1);
  // 分段切換在下一列、靠左
  const mode = page.getByRole("group", { name: s.graphKeyboard.modeLabel });
  const modeBox = await box(mode);
  expect(modeBox.y).toBeGreaterThanOrEqual(field.y + field.height);
  expect(Math.abs(modeBox.x - field.x)).toBeLessThan(2);
  await expect(mode.getByRole("button", { name: s.graphKeyboard.modeGraph })).toHaveAttribute("aria-pressed", "true");

  // 畫布：從分段切換下方填滿到分頁列上方，不套卡片（沒有框線與圓角）
  const canvas = await box(page.locator(CANVAS));
  const bar = await box(page.locator(".mobile-tabbar"));
  expect(Math.abs(canvas.y + canvas.height - bar.y)).toBeLessThan(2);
  expect(canvas.y - (modeBox.y + modeBox.height)).toBeLessThanOrEqual(12);
  expect(canvas.width).toBeGreaterThanOrEqual(388);
  await expect(page.locator(CANVAS)).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(CANVAS)).toHaveCSS("border-radius", "0px");

  // 右下的數量：只算目前身分看得到的實體與關係
  const graph = visibleGraph(access.roles[0].id);
  const counts = page.locator(".graph-counts");
  await expect(counts).toContainText(String(graph.entities.length));
  await expect(counts).toContainText(String(graph.relations.length));
  const countsBox = await box(counts);
  expect(canvas.x + canvas.width - (countsBox.x + countsBox.width)).toBeLessThanOrEqual(16);
  expect(canvas.y + canvas.height - (countsBox.y + countsBox.height)).toBeLessThanOrEqual(16);

  await expectTouchTargets(main);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "graph");

  // 篩選與找路徑收在篩選按鈕打開的底部面板
  await filters.click();
  const sheet = page.locator("dialog.graph-filters");
  await expect(sheet.getByRole("list", { name: s.legend })).toBeVisible();
  await expect(sheet.getByText(s.pathTitle)).toBeVisible();
  await settle(sheet);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "filters");
});

test("選取後實體面板停在約一半高，節點在畫布可見的上半部；面板內容照畫板，觸控目標至少 44px", async ({ page }, testInfo) => {
  await openGraph(page);
  const node = await uniqueNode(page);
  test.skip(node === null, "圖中沒有名稱不重複的節點");
  const { id, name } = node!;
  await search(page).fill(name);
  await page.getByRole("option", { name: new RegExp(`^${escape(name)} `) }).click();
  const sheet = entitySheet(page);
  await expect(sheet).toBeVisible();
  await settle(sheet);
  await waitForGraphIdle(page, CANVAS);

  // 面板約一半高（56%）
  const sheetBox = await box(sheet);
  expect(sheetBox.height / 844).toBeGreaterThan(0.5);
  expect(sheetBox.height / 844).toBeLessThan(0.6);
  // 選取的節點在畫布可見的部分（面板以上）之中、在畫面的上半部
  const at = await page.evaluate(
    ({ selector, id }) => {
      const container = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!;
      const rect = container.getBoundingClientRect();
      const p = container._cyreg!.cy!.$id(id).renderedPosition();
      return { x: rect.left + p.x, y: rect.top + p.y };
    },
    { selector: CANVAS, id },
  );
  const canvas = await box(page.locator(CANVAS));
  expect(at.y).toBeGreaterThan(canvas.y);
  expect(at.y).toBeLessThan(sheetBox.y);
  expect(at.y).toBeLessThan(844 / 2);

  const panel = sheet.getByRole("region", { name });
  // 類型膠囊、名稱與「關聯 N · 文件 N」同一列（垂直方向重疊），由左而右；手機不列出處數
  const badge = await box(panel.locator(".entity-badge"));
  const title = await box(panel.getByRole("heading", { level: 2 }));
  const counts = await box(panel.locator(".entity-counts"));
  for (const b of [title, counts]) expect(Math.abs(b.y + b.height / 2 - (badge.y + badge.height / 2))).toBeLessThan(badge.height);
  expect(title.x).toBeGreaterThan(badge.x);
  expect(counts.x).toBeGreaterThan(title.x);
  await expect(panel.locator(".entity-counts")).not.toContainText(s.graphSourceCount.replace(/\s*\{count\}\s*/, ""));
  // 「在問答中問」「只看它」等寬、同一列，在標題列下方
  const ask = await box(panel.getByRole("button", { name: s.graphAskAbout }));
  const only = await box(panel.getByRole("button", { name: s.graphShowOnly }));
  expect(Math.abs(ask.width - only.width)).toBeLessThan(2);
  expect(Math.abs(ask.y - only.y)).toBeLessThan(2);
  expect(ask.y).toBeGreaterThan(badge.y + badge.height);
  // 相關實體每則一列（整列寬）
  const rows = panel.locator(".entity-row");
  for (const row of await rows.all()) expect((await box(row)).width).toBeGreaterThan(sheetBox.width - 40);

  await expectTouchTargets(sheet);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "entity-half");

  // 往上拉看全部
  const handle = await box(sheet.locator(".bottom-sheet__handle"));
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 150, { steps: 8 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute("data-stop", "full");
  await settle(sheet);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, testInfo, "entity-full");

  // 點相關實體：行為不變（從它繼續展開，面板換成它）
  if ((await rows.count()) > 0) {
    const next = await rows.first().getByRole("button").innerText();
    await rows.first().getByRole("button").click();
    await expect(sheet.getByRole("region", { name: next })).toBeVisible();
  }
});
