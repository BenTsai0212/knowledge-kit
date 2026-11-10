// 圖譜的找起點與右側面板（#199，docs/graph.md「找起點與右側面板」）：搜尋 → 展開兩層 → 回到全部；依身分搜尋結果不同；
// 在問答中問（填進輸入框、不送出）；類型篩選；多跳路徑；手機寬度。圖譜不呼叫模型，不點畫布（展開從搜尋與面板操作）。
import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, s, switchIdentity, tab } from "./support/app";
import { knowledgeModel, language, nonReviewer, reviewer } from "./support/client";
import type { Cy } from "./support/graph";

const CANVAS = ".graph-page .graph-canvas";

interface GraphData {
  ids: string[];
  labels: Record<string, string>;
  neighbors: Record<string, string[]>;
  dimmed: string[];
  selected: string[];
}

// 畫布中的節點：顯示名稱、鄰居、變灰與選取
async function graphData(page: Page): Promise<GraphData | null> {
  return page.evaluate((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)?._cyreg?.cy;
    if (cy === undefined || cy.nodes().length === 0) return null;
    const ids = cy.nodes().map((n) => n.id());
    return {
      ids,
      labels: Object.fromEntries(ids.map((id) => [id, cy.$id(id).data("label")])),
      neighbors: Object.fromEntries(ids.map((id) => [id, cy.$id(id).neighborhood("node").map((n) => n.id())])),
      dimmed: ids.filter((id) => cy.$id(id).hasClass("dimmed")),
      selected: ids.filter((id) => cy.$id(id).hasClass("selected")),
    };
  }, CANVAS);
}

async function openGraph(page: Page, identity: string | undefined): Promise<GraphData> {
  await openApp(page);
  if (identity !== undefined) await switchIdentity(page, identity);
  await openTab(page, s.tabGraph);
  let data: GraphData | null = null;
  await expect(async () => {
    data = await graphData(page);
    expect(data).not.toBeNull();
  }).toPass();
  return data!;
}

// 顯示名稱不重複、而且有名稱也不重複的鄰居 b 的節點 a（搜尋與面板以名稱操作）
function pair(data: GraphData): { a: string; b: string } | null {
  const counts = new Map<string, number>();
  for (const id of data.ids) counts.set(data.labels[id], (counts.get(data.labels[id]) ?? 0) + 1);
  const unique = (id: string) => counts.get(data.labels[id]) === 1;
  for (const a of data.ids.filter(unique)) {
    const b = data.neighbors[a].find(unique);
    if (b !== undefined) return { a, b };
  }
  return null;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const search = (page: Page, label = s.graphSearch) => page.getByRole("combobox", { name: label, exact: true });
// 選項的名稱是「實體名稱 類型」
const option = (page: Page, name: string) => page.getByRole("option", { name: new RegExp(`^${escape(name)} `) });
const trail = (page: Page) => page.getByRole("navigation", { name: s.graphExpanded });

async function searchAndPick(page: Page, name: string, label = s.graphSearch): Promise<void> {
  await search(page, label).fill(name);
  await option(page, name).click();
}

test("搜尋 → 展開兩層 → 回到全部", async ({ page }) => {
  const data = await openGraph(page, reviewer?.id);
  const found = pair(data);
  test.skip(found === null, "圖中沒有名稱不重複、而且有名稱不重複的鄰居的節點");
  const { a, b } = found!;
  // 沒有選取：右側列出關聯最多的實體
  await expect(page.getByRole("region", { name: s.graphTopConnected }).getByRole("listitem").first()).toBeVisible();

  // 搜尋 a：從它開始展開
  await searchAndPick(page, data.labels[a]);
  await expect(trail(page).getByRole("listitem")).toHaveText([data.labels[a]]);
  await expect.poll(async () => (await graphData(page))!.selected).toEqual([a]);
  const panel = page.getByRole("region", { name: data.labels[a] });
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(data.labels[a]);

  // 面板的關係清單中點 b：從 b 繼續展開
  await panel.getByRole("button", { name: data.labels[b], exact: true }).first().click();
  await expect(trail(page).getByRole("listitem")).toHaveText([data.labels[a], data.labels[b]]);
  const focus = new Set([a, b, ...data.neighbors[a], ...data.neighbors[b]]);
  await expect.poll(async () => [...(await graphData(page))!.dimmed].sort()).toEqual(data.ids.filter((id) => !focus.has(id)).sort());

  // 回到全部
  await trail(page).getByRole("button", { name: s.graphShowAll }).click();
  await expect(trail(page)).toHaveCount(0);
  await expect.poll(async () => (await graphData(page))!.dimmed).toEqual([]);
  await expect(page.getByRole("region", { name: s.graphTopConnected })).toBeVisible();
});

test("依身分不同：一般身分搜尋不到看不到的實體，能審查的身分搜尋得到", async ({ page }) => {
  test.skip(reviewer === undefined || nonReviewer === undefined, "access.json 需要能審查與不能審查的身分");
  const wide = await openGraph(page, reviewer!.id);
  await switchIdentity(page, nonReviewer!.id);
  let narrow: GraphData | null = null;
  await expect(async () => {
    narrow = await graphData(page);
    expect(narrow).not.toBeNull();
    expect(narrow!.ids.length).toBeLessThan(wide.ids.length);
  }).toPass();
  const visible = Object.values(narrow!.labels).map((l) => l.toLowerCase());
  // 一般身分看不到、名稱也不是一般身分看得到的名稱的一部分
  const hidden = wide.ids.map((id) => wide.labels[id]).find((label) => !visible.some((v) => v.includes(label.toLowerCase())));
  test.skip(hidden === undefined, "能審查的身分沒有比一般身分多看到、名稱可區分的實體");

  // 同名的實體在選項中附上相關實體的名稱，所以以包含名稱比對
  const matching = () => page.getByRole("option").filter({ hasText: hidden! });
  await search(page).fill(hidden!);
  await expect(search(page)).toHaveAttribute("aria-expanded", "true");
  await expect(matching()).toHaveCount(0);

  await switchIdentity(page, reviewer!.id);
  await expect.poll(async () => (await graphData(page))?.ids.length).toBe(wide.ids.length);
  await search(page).fill(hidden!);
  await expect(matching().first()).toBeVisible();
});

test("在問答中問：切到問答頁，問句填進輸入框，不送出", async ({ page }) => {
  const data = await openGraph(page, reviewer?.id);
  const found = pair(data);
  test.skip(found === null, "圖中沒有名稱不重複的節點");
  const name = data.labels[found!.a];
  await searchAndPick(page, name);
  await page.getByRole("region", { name }).getByRole("button", { name: s.graphAskAbout }).click();
  await expect(tab(page, s.tabQa)).toHaveAttribute("aria-current", "page");
  await expect(page.getByPlaceholder(s.questionPlaceholder)).toHaveValue(s.askAboutEntity.replace("{name}", name));
  await expect(page.locator("section.answer")).toHaveCount(0);
});

test("類型篩選：沒勾的類型變灰，搜尋不到", async ({ page }) => {
  const data = await openGraph(page, reviewer?.id);
  const found = pair(data);
  test.skip(found === null, "圖中沒有名稱不重複的節點");
  const name = data.labels[found!.a];
  const type = await page.evaluate(({ selector, id }) => document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!._cyreg!.cy!.$id(id).data("type"), {
    selector: CANVAS,
    id: found!.a,
  });
  const label = knowledgeModel.entityTypes.find((t) => t.id === type)!.label[language];
  const checkbox = page.getByRole("list", { name: s.legend }).getByRole("checkbox", { name: label, exact: true });
  await checkbox.uncheck();
  await expect.poll(async () => (await graphData(page))!.dimmed).toContain(found!.a);
  await search(page).fill(name);
  await expect(option(page, name)).toHaveCount(0);
  await checkbox.check();
  await expect.poll(async () => (await graphData(page))!.dimmed).toEqual([]);
});

test("多跳路徑：起點預設為選取的實體，終點以搜尋選擇，列出路徑", async ({ page }) => {
  const data = await openGraph(page, reviewer?.id);
  const found = pair(data);
  test.skip(found === null, "圖中沒有名稱不重複、而且有名稱不重複的鄰居的節點");
  const { a, b } = found!;
  await searchAndPick(page, data.labels[a]);
  await page.locator("details.path summary").click();
  await expect(search(page, s.pathFrom)).toHaveValue(data.labels[a]);
  await searchAndPick(page, data.labels[b], s.pathTo);
  const steps = page.locator("details.path > ol > li > strong");
  await expect(steps).toHaveText([data.labels[a], data.labels[b]]);
});

test.describe("手機寬度", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("可以搜尋與展開，整頁沒有橫向捲動", async ({ page }) => {
    const data = await openGraph(page, reviewer?.id);
    const found = pair(data);
    test.skip(found === null, "圖中沒有名稱不重複的節點");
    const name = data.labels[found!.a];
    await searchAndPick(page, name);
    await expect(trail(page).getByRole("listitem")).toHaveText([name]);
    await expect(page.getByRole("region", { name })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
