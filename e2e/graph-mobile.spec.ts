// 手機的圖譜（#257，docs/design.md「圖譜（手機）」）：390×844 時圖譜佔滿頂端列與分頁列之間、頁面不捲動；
// 上方是搜尋、「篩選與找路徑」（底部面板）與「圖譜｜清單」；搜尋或點節點打開實體面板（停在 56% 高、往上拉到全高），關閉後保留選取。
// 選取的節點平移到上半部中央與面板內容的順序在 #257 的下一個 PR。雙指縮放、往上拉的手感與 safe area 由人在實機確認。
// 圖譜不呼叫模型；/api/ask 不會被呼叫（在問答中問只填進輸入框）
import { expect, test, type Page } from "@playwright/test";
import { scaleMode } from "../app/src/graph/clusters";
import { openApp, openTab, s, tab } from "./support/app";
import { access } from "./support/client";
import { visibleGraph } from "./support/dataset";
import { clickNodeOnce, selectedNodes, waitForGraphIdle, type Cy } from "./support/graph";

test.use({ viewport: { width: 390, height: 844 } });

const CANVAS = ".graph-page .graph-canvas";
const entitySheet = (page: Page) => page.locator("dialog.entity-sheet");
const filtersSheet = (page: Page) => page.locator("dialog.graph-filters");
const filtersButton = (page: Page) => page.getByRole("button", { name: s.graphFilters });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(2);

async function openGraph(page: Page): Promise<void> {
  await openApp(page);
  await openTab(page, s.tabGraph);
  await waitForGraphIdle(page, CANVAS);
}

// 畫布中名稱不重複的第一個節點（以名稱搜尋）
async function uniqueNode(page: Page): Promise<{ id: string; name: string } | null> {
  return page.evaluate((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!._cyreg!.cy!;
    const nodes = cy.nodes().map((n) => ({ id: n.id(), name: n.data("label") }));
    return nodes.find((n) => nodes.filter((m) => m.name === n.name).length === 1) ?? null;
  }, CANVAS);
}

// 面板的進場動畫（kSheetUp）與高度的 transition 播完為止（把手位置不再變動）。
// 動畫中讀把手位置，按下時面板已經移走，pointerdown 會落在內容上（#321 的修正要求）
async function waitForSheetSettled(page: Page): Promise<void> {
  const sheet = entitySheet(page);
  await expect.poll(() => sheet.evaluate((el) => el.getAnimations().length)).toBe(0);
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const top = (await sheet.boundingBox())!.y;
      const stable = top === last;
      last = top;
      return stable;
    })
    .toBe(true);
}

// 在拖曳把手上拖曳（滑鼠的 pointer 事件）；先等面板停穩再讀把手位置
async function dragHandle(page: Page, dy: number): Promise<void> {
  await waitForSheetSettled(page);
  const handle = (await entitySheet(page).locator(".bottom-sheet__handle").boundingBox())!;
  const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 8 });
  await page.mouse.up();
}

test("圖譜佔滿頂端列與分頁列之間；上方是搜尋、「篩選與找路徑」與「圖譜｜清單」，觸控目標至少 44px", async ({ page }) => {
  await openGraph(page);
  const top = (await page.locator(".mobile-topbar").boundingBox())!;
  const bar = (await page.locator(".mobile-tabbar").boundingBox())!;
  const graphPage = (await page.locator(".graph-page").boundingBox())!;
  near(graphPage.y, top.y + top.height);
  near(graphPage.y + graphPage.height, bar.y);
  // 畫布延伸到分頁列
  const canvas = (await page.locator(CANVAS).boundingBox())!;
  near(canvas.y + canvas.height, bar.y);

  const controls = [
    page.getByRole("combobox", { name: s.graphSearch, exact: true }),
    filtersButton(page),
    page.getByRole("group", { name: s.graphKeyboard.modeLabel }).getByRole("button", { name: s.graphKeyboard.modeGraph }),
    page.getByRole("group", { name: s.graphKeyboard.modeLabel }).getByRole("button", { name: s.graphKeyboard.modeList }),
  ];
  for (const control of controls) {
    await expect(control).toBeVisible();
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  // 類型篩選與多跳路徑不在畫面上，收在「篩選與找路徑」
  await expect(page.getByRole("list", { name: s.legend })).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("「篩選與找路徑」打開底部面板：類型篩選、多跳路徑與關聯最多的實體；Esc 關閉後焦點回到按鈕", async ({ page }) => {
  await openGraph(page);
  await filtersButton(page).click();
  await expect(filtersSheet(page)).toBeVisible();
  await expect(filtersSheet(page).getByRole("heading", { name: s.graphFilters })).toBeVisible();
  await expect(filtersSheet(page).getByRole("list", { name: s.legend })).toBeVisible();
  await expect(filtersSheet(page).getByText(s.pathTitle)).toBeVisible();
  await expect(filtersSheet(page).getByRole("region", { name: s.graphTopConnected })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(filtersSheet(page)).toBeHidden();
  await expect(filtersButton(page)).toBeFocused();
});

test("在畫布上拖曳只移動圖譜，頁面本身不捲動", async ({ page }) => {
  await openGraph(page);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  const box = (await page.locator(CANVAS).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 200, { steps: 10 });
  await page.mouse.up();
  await page.mouse.wheel(0, 400);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("搜尋 → 實體面板（56% 高、可拉到全高）→ 關閉後保留選取 → 點節點重新打開 → 在問答中問", async ({ page }) => {
  await openGraph(page);
  const node = await uniqueNode(page);
  test.skip(node === null, "圖中沒有名稱不重複的節點");
  const { id, name } = node!;

  await page.getByRole("combobox", { name: s.graphSearch, exact: true }).fill(name);
  await page.getByRole("option", { name: new RegExp(`^${escape(name)} `) }).click();
  const sheet = entitySheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("region", { name })).toBeVisible();
  await expect(sheet).toHaveAttribute("data-stop", "half");
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(Math.round(844 * 0.56));
  // 進場動畫播完後，面板頂端停在 56% 的位置
  await waitForSheetSettled(page);
  near((await sheet.boundingBox())!.y, 844 - Math.round(844 * 0.56));
  expect(await noHorizontalScroll(page)).toBe(true);

  // 往上拉到全高，往下拉回 56%
  await dragHandle(page, -150);
  await expect(sheet).toHaveAttribute("data-stop", "full");
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(844);
  await dragHandle(page, 150);
  await expect(sheet).toHaveAttribute("data-stop", "half");

  // 關閉只收起面板：選取與展開路徑不變
  await sheet.getByRole("button", { name: s.dialogClose }).click();
  await expect(sheet).toBeHidden();
  expect(await selectedNodes(page, CANVAS)).toContain(id);

  // 門檻以下（全部節點）時再點同一個節點，重新打開實體面板
  const role = access.roles[0].id;
  if (scaleMode(visibleGraph(role).entities.length, true) === "all") {
    await waitForGraphIdle(page, CANVAS);
    await clickNodeOnce(page, CANVAS, id);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("region", { name })).toBeVisible();
  } else {
    // 門檻以上時畫布是三層語意縮放（#254），改從搜尋重新打開
    await page.getByRole("combobox", { name: s.graphSearch, exact: true }).fill(name);
    await page.getByRole("option", { name: new RegExp(`^${escape(name)} `) }).click();
    await expect(sheet).toBeVisible();
  }

  await sheet.getByRole("button", { name: s.graphAskAbout }).click();
  await expect(tab(page, s.tabQa)).toHaveAttribute("aria-current", "page");
  await expect(page.getByPlaceholder(s.questionPlaceholder)).toHaveValue(s.askAboutEntity.replace("{name}", name));
  await expect(page.locator("section.answer")).toHaveCount(0);
});
