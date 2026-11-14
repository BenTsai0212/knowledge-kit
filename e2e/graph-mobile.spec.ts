// 手機的圖譜（#257，docs/design.md「圖譜（手機）」）：390×844 時圖譜佔滿頂端列與分頁列之間、頁面不捲動；
// 上方是搜尋、「篩選與找路徑」（底部面板）與「圖譜｜清單」；搜尋或點節點打開實體面板（停在 56% 高、往上拉到全高），關閉後保留選取。
// 實體面板開著時，選取的節點平移到面板以上（上半部）的中央，「關閉」在標題列右側；面板內容依序是類型膠囊、名稱與數量（同一列）、「在問答中問」「只看它」、
// 相關實體的列、原文片段（#357，版面的細節見 mobile-graph-design.spec.ts）。
// 雙指縮放、往上拉的手感與 safe area 由人在實機確認。
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
  // 標題只給報讀器，「關閉」仍在右側：右緣距面板右緣 24px 內
  const closeBox = (await sheet.getByRole("button", { name: s.dialogClose }).boundingBox())!;
  const sheetBox = (await sheet.boundingBox())!;
  expect(sheetBox.x + sheetBox.width - (closeBox.x + closeBox.width)).toBeLessThanOrEqual(24);

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

// 選取的節點在畫面上的位置（視窗座標）
async function nodeOnScreen(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ selector, id }) => {
      const container = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!;
      const box = container.getBoundingClientRect();
      const { x, y } = container._cyreg!.cy!.$id(id).renderedPosition();
      return { x: box.left + x, y: box.top + y };
    },
    { selector: CANVAS, id },
  );
}

// 面板以上的可見部分（畫布上緣到面板上緣；浮在畫布上方的「已展開」列有顯示時從它的下緣開始，#357 修正要求）的中央
async function upperCenter(page: Page): Promise<{ x: number; y: number }> {
  const canvas = (await page.locator(CANVAS).boundingBox())!;
  const sheetTop = (await entitySheet(page).boundingBox())!.y;
  const trail = (await page.locator(".graph-phone-stage .graph-trail").boundingBox()) ?? null;
  const top = trail !== null && trail.height > 0 ? trail.y + trail.height : canvas.y;
  return { x: canvas.x + canvas.width / 2, y: (top + Math.min(sheetTop, canvas.y + canvas.height)) / 2 };
}

test("實體面板：選取的節點平移到面板以上的中央，內容依序排列", async ({ page }) => {
  await openGraph(page);
  const node = await uniqueNode(page);
  test.skip(node === null, "圖中沒有名稱不重複的節點");
  const { id, name } = node!;

  await page.getByRole("combobox", { name: s.graphSearch, exact: true }).fill(name);
  await page.getByRole("option", { name: new RegExp(`^${escape(name)} `) }).click();
  const sheet = entitySheet(page);
  await waitForSheetSettled(page);
  await waitForGraphIdle(page, CANVAS);
  const target = await upperCenter(page);
  const at = await nodeOnScreen(page, id);
  near(at.x, target.x);
  near(at.y, target.y);

  // 內容的順序（由上而下，#357 畫板 G-Mobile-Graph）：類型膠囊、名稱與數量同一列，「在問答中問」「只看它」，相關實體的列，原文片段（reading 紙面）
  const panel = sheet.getByRole("region", { name });
  const header = (await panel.locator(".entity-badge").boundingBox())!;
  const actions = (await panel.locator(".entity-actions").boundingBox())!;
  expect(actions.y).toBeGreaterThan(header.y + header.height);
  const rows = panel.locator(".entity-row");
  const ys: number[] = [actions.y + actions.height];
  for (const row of await rows.all()) ys.push((await row.boundingBox())!.y);
  const excerpts = panel.locator(".entity-excerpt");
  if ((await excerpts.count()) > 0) ys.push((await excerpts.first().boundingBox())!.y);
  expect(ys).toEqual([...ys].sort((a, b) => a - b));
  // 「相關實體」「出現的文件」的標題仍在（只給報讀器）
  await expect(panel.getByRole("heading", { name: s.relatedEntities, level: 3 })).toHaveCount(1);
  await expect(panel.getByRole("heading", { name: s.entitySources, level: 3 })).toHaveCount(1);
  expect(await noHorizontalScroll(page)).toBe(true);
});

// 畫布目前的縮放
const zoomOf = (page: Page) => page.evaluate((selector) => document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!._cyreg!.cy!.zoom(), CANVAS);

// #323 修正要求：面板以上的可見部分可能很矮（上方多了「已展開」一列），縮小到放得進聚焦集合時節點小到看不出是哪個實體，所以只平移、不縮小
test("實體面板打開、節點平移後縮放不小於打開前（只平移、不縮小）", async ({ page }) => {
  await openGraph(page);
  const node = await uniqueNode(page);
  test.skip(node === null, "圖中沒有名稱不重複的節點");
  const { id, name } = node!;
  const sheet = entitySheet(page);
  const search = async () => {
    await page.getByRole("combobox", { name: s.graphSearch, exact: true }).fill(name);
    await page.getByRole("option", { name: new RegExp(`^${escape(name)} `) }).click();
    await expect(sheet).toBeVisible();
    await waitForSheetSettled(page);
    await waitForGraphIdle(page, CANVAS);
  };

  // 門檻以下（全部節點）：搜尋選取並打開面板時縮放不變。門檻以上時換到細節層，縮放與沒有面板時相同（由細節層的視角決定）
  const before = await zoomOf(page);
  await search();
  if (scaleMode(visibleGraph(access.roles[0].id).entities.length, true) === "all") expect(await zoomOf(page)).toBeGreaterThanOrEqual(before - 1e-6);

  // 關閉後選取不變；從搜尋重新打開同一個實體時，只把節點平移到面板以上的中央，縮放不變
  await sheet.getByRole("button", { name: s.dialogClose }).click();
  await expect(sheet).toBeHidden();
  await waitForGraphIdle(page, CANVAS);
  const closed = await zoomOf(page);
  await search();
  expect(await zoomOf(page)).toBeGreaterThanOrEqual(closed - 1e-6);
  const [target, at] = [await upperCenter(page), await nodeOnScreen(page, id)];
  near(at.x, target.x);
  near(at.y, target.y);
});
