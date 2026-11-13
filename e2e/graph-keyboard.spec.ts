// 圖譜的鍵盤操作與報讀（#289，docs/design.md「圖譜的鍵盤操作與螢幕報讀器」）：以 Tab 進入圖譜、方向鍵移動、Enter 前往、
// Backspace 回到全部、? 按鍵表、/ 搜尋、Tab 離開；報讀區的文字與目前身分看得到的數量（#247）；減少動態效果時平移直接到位；
// 清單模式（「圖譜｜清單」切換、關係句的連結、記在這個瀏覽器）。
// 圖譜不呼叫模型。節點以 cytoscape 的實例（容器的 _cyreg）讀取 class 與位置（e2e/support/graph.ts）。
import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, s, switchIdentity } from "./support/app";
import { access, reviewer } from "./support/client";
import { selectedNodes, waitForGraphIdle } from "./support/graph";

const CANVAS = ".graph-page .graph-canvas";
const k = s.graphKeyboard;

type Box = { x1: number; y1: number; x2: number; y2: number };
type KbCy = {
  animated(): boolean;
  extent(): Box;
  nodes(): { map<T>(fn: (n: { id(): string; hasClass(c: string): boolean; data(key: string): string }) => T): T[] };
  edges(): { length: number };
  $id(id: string): { boundingBox(): Box; data(key: string): string; neighborhood(selector: string): { length: number } };
};

const frame = (page: Page) => page.getByRole("application", { name: k.label });
const announcer = (page: Page) => page.getByTestId("graph-announcer");
const trail = (page: Page) => page.getByRole("navigation", { name: s.graphExpanded });

// 畫布的狀態：節點與線的數量、帶某個 class 的節點與它的完整名稱
async function graphState(page: Page) {
  return page.evaluate((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: KbCy } }>(selector)!._cyreg!.cy!;
    const withClass = (c: string) => cy.nodes().map((n) => (n.hasClass(c) ? n.id() : null)).filter((id): id is string => id !== null);
    const label = (id: string | undefined) => (id === undefined ? "" : cy.$id(id).data("label"));
    const [current, cursor] = [withClass("kb-current")[0], withClass("kb-cursor")[0]];
    return {
      nodes: cy.nodes().map((n) => n.id()).length,
      edges: cy.edges().length,
      current,
      currentLabel: label(current),
      cursor,
      cursorLabel: label(cursor),
      neighbors: current === undefined ? 0 : cy.$id(current).neighborhood("node").length,
    };
  }, CANVAS);
}

// 游標所在的節點整個在畫面內
async function cursorInside(page: Page): Promise<boolean> {
  return page.evaluate((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: KbCy } }>(selector)!._cyreg!.cy!;
    const cursor = cy.nodes().map((n) => (n.hasClass("kb-cursor") ? n.id() : null)).find((id) => id !== null);
    if (cursor == null) return false;
    const [box, extent] = [cy.$id(cursor).boundingBox(), cy.extent()];
    return box.x1 >= extent.x1 && box.x2 <= extent.x2 && box.y1 >= extent.y1 && box.y2 <= extent.y2;
  }, CANVAS);
}

// 外框的前一個可聚焦元素按 Tab 進入：桌機（預設 1280×720，#336）是畫布右下的「縮小」（縮放按鈕在 DOM 中排在外框之前）；
// 其他版面是「圖譜｜清單」切換的最後一個按鈕（沒有展開時「已展開」那一列沒有按鈕）
async function tabIntoGraph(page: Page) {
  await waitForGraphIdle(page, CANVAS);
  const zoomOut = page.getByRole("button", { name: s.graphZoomOut, exact: true });
  await ((await zoomOut.count()) > 0 ? zoomOut : page.getByRole("group", { name: k.modeLabel }).getByRole("button").last()).focus();
  await page.keyboard.press("Tab");
  await expect(frame(page)).toBeFocused();
}

test("以鍵盤從進入圖譜走到另一個實體，報讀區說出每一步；按鍵表、搜尋、Tab 離開", async ({ page }) => {
  await openApp(page);
  if (reviewer !== undefined) await switchIdentity(page, reviewer.id);
  await openTab(page, s.tabGraph);
  await tabIntoGraph(page);

  // 外框：role="application"、aria-roledescription；鍵盤聚焦時出現按鍵提示列
  await expect(frame(page)).toHaveAttribute("aria-roledescription", k.roleDescription);
  await expect(page.locator(".graph-keys")).toBeVisible();

  // 進入：沒有選取時目前的實體是關聯最多的實體（只畫圈），報讀實體與關係數和目前的實體
  await expect.poll(async () => (await graphState(page)).current).toBeDefined();
  const entered = await graphState(page);
  await expect(announcer(page)).toContainText(String(entered.nodes));
  await expect(announcer(page)).toContainText(entered.currentLabel);
  expect(await selectedNodes(page, CANVAS)).toEqual([]);
  expect(entered.neighbors).toBeGreaterThan(0);

  // →：游標移到第一個相關實體，報讀它的名稱
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await graphState(page)).cursor).toBeDefined();
  const moved = await graphState(page);
  expect(moved.cursor).not.toBe(entered.current);
  await expect(announcer(page)).toContainText(moved.cursorLabel);

  // Enter：前往游標所在的實體，實體面板同步，焦點留在圖譜
  await page.keyboard.press("Enter");
  await expect.poll(() => selectedNodes(page, CANVAS)).toEqual([moved.cursor]);
  await expect(page.getByRole("region", { name: moved.cursorLabel })).toBeVisible();
  await expect(frame(page)).toBeFocused();
  await expect(announcer(page)).toContainText(moved.cursorLabel);
  await expect.poll(async () => (await graphState(page)).current).toBe(moved.cursor);

  // Backspace：路徑只有一層時回到全部；已是全部時說已經是第一個實體
  await page.keyboard.press("Backspace");
  await expect(trail(page)).toHaveCount(0);
  expect(await selectedNodes(page, CANVAS)).toEqual([]);
  await expect(announcer(page)).toContainText(String(entered.nodes));
  await page.keyboard.press("Backspace");
  await expect(announcer(page)).toHaveText(k.atStart);

  // ?：按鍵表；Esc 關閉後焦點回到圖譜
  await page.keyboard.type("?");
  const help = page.getByRole("dialog", { name: k.helpTitle });
  await expect(help).toBeVisible();
  await expect(help).toContainText(k.helpMove);
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(frame(page)).toBeFocused();

  // /：跳到搜尋名稱；選了結果後焦點回到圖譜
  await page.keyboard.type("/");
  const search = page.getByRole("combobox", { name: s.graphSearch });
  await expect(search).toBeFocused();
  await search.fill(moved.cursorLabel);
  await page.keyboard.press("Enter");
  await expect(frame(page)).toBeFocused();
  await expect.poll(async () => (await selectedNodes(page, CANVAS)).length).toBe(1);

  // Tab：離開圖譜到實體面板（桌機是右側的實體欄，#336）
  await page.keyboard.press("Tab");
  await expect(frame(page)).not.toBeFocused();
  await expect(page.locator(".graph-entity-column :focus")).toHaveCount(1);
  await expect(page.locator(".graph-keys")).toBeHidden();
});

test("進入圖譜時報讀的數量只算目前身分看得到的（#247）", async ({ page }) => {
  await openApp(page);
  await openTab(page, s.tabGraph);
  for (const role of access.roles) {
    await switchIdentity(page, role.id);
    // 看不到任何實體的身分是空狀態，沒有圖譜可進入
    await expect(page.locator(`${CANVAS} canvas, .empty-state`).first()).toBeVisible();
    if (await page.locator(".empty-state").isVisible()) continue;
    await tabIntoGraph(page);
    const { nodes, edges } = await graphState(page);
    await expect(announcer(page)).toContainText(String(nodes));
    await expect(announcer(page)).toContainText(String(edges));
  }
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test.describe(reducedMotion, () => {
    test.use({ reducedMotion });

    test("放大後游標移到畫面外時平移到看得見的位置（減少動態效果時直接到位）", async ({ page }) => {
      await openApp(page);
      if (reviewer !== undefined) await switchIdentity(page, reviewer.id);
      await openTab(page, s.tabGraph);
      await tabIntoGraph(page);
      for (let i = 0; i < 4; i++) await page.keyboard.press("Equal");
      await waitForGraphIdle(page, CANVAS);
      const { neighbors } = await graphState(page);
      for (let i = 0; i < neighbors; i++) {
        await page.keyboard.press("ArrowRight");
        // 按鍵後 30 個 frame 內：游標在畫面內；減少動態效果時一次也沒有動畫
        const animated = await page.evaluate(async (selector) => {
          const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: KbCy } }>(selector)!._cyreg!.cy!;
          let seen = false;
          for (let frame = 0; frame < 30; frame++) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            seen ||= cy.animated();
          }
          return seen;
        }, CANVAS);
        const result = { animated, inside: await cursorInside(page) };
        if (reducedMotion === "reduce") expect(result).toEqual({ animated: false, inside: true });
        else {
          // 平移（sweep）結束後游標在畫面內
          await waitForGraphIdle(page, CANVAS);
          expect(await cursorInside(page)).toBe(true);
        }
      }
    });
  });
}

test("清單模式：切換、篩選共用、關係句的連結跳到該項、選取與圖譜共用、選擇記在這個瀏覽器", async ({ page }) => {
  await openApp(page);
  if (reviewer !== undefined) await switchIdentity(page, reviewer.id);
  await openTab(page, s.tabGraph);
  const modes = page.getByRole("group", { name: k.modeLabel });
  await modes.getByRole("button", { name: k.modeList }).click();
  await expect(modes.getByRole("button", { name: k.modeList })).toHaveAttribute("aria-pressed", "true");
  const list = page.getByRole("region", { name: k.listLabel });
  await expect(list).toBeVisible();
  await expect(frame(page)).toHaveCount(0);

  // 類型篩選共用：取消勾選全部類型時清單沒有實體，勾回來後恢復（群組是 #254 的分群，見 graph-scale.spec.ts）
  const items = list.locator(":scope > section > ul > li");
  const listed = await items.count();
  expect(listed).toBeGreaterThan(0);
  const typeBoxes = page.locator(".graph-page .legend input[type=checkbox]");
  for (const box of await typeBoxes.all()) await box.uncheck();
  await expect(page.locator(".graph-list")).toHaveText(k.listEmpty);
  for (const box of await typeBoxes.all()) await box.check();
  await expect(items).toHaveCount(listed);

  // 關係句中的實體名稱是連結：跳到清單中的那一項（焦點移到它的名稱按鈕）
  const link = list.locator(".graph-list-relations a").first();
  const anchor = (await link.getAttribute("href"))!.slice(1);
  await link.click();
  const item = list.locator(`[id="${anchor}"]`);
  await expect(item.locator(":scope > .graph-list-name")).toBeFocused();

  // 名稱按鈕打開實體面板，它成為目前的實體
  const name = (await item.locator(":scope > .graph-list-name").innerText()).trim();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  await expect(item).toHaveAttribute("aria-current", "true");

  // 切回圖譜：選取的實體保留（桌機的「清單模式」是一個切換按鈕，#336）
  await modes.getByRole("button", { name: k.modeList }).click();
  await expect(modes.getByRole("button", { name: k.modeList })).toHaveAttribute("aria-pressed", "false");
  await expect(frame(page)).toBeVisible();
  await expect.poll(() => selectedNodes(page, CANVAS)).toEqual([anchor.slice("graph-list-".length)]);

  // 選擇記在這個瀏覽器：另開一頁時仍是清單
  await modes.getByRole("button", { name: k.modeList }).click();
  const other = await page.context().newPage();
  await openApp(other);
  await openTab(other, s.tabGraph);
  await expect(other.getByRole("region", { name: k.listLabel })).toBeVisible();
  await expect(other.getByRole("group", { name: k.modeLabel }).getByRole("button", { name: k.modeList })).toHaveAttribute("aria-pressed", "true");
});
