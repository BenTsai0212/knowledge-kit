// 圖譜的逐步展開（#199，docs/graph.md「逐步展開」）：點節點聚焦、再點相連的節點累積展開、點路徑的一段回到該層、回到全部。
// 圖譜不呼叫模型。節點以 cytoscape 的實例（容器的 _cyreg）取得在畫面上的位置後以滑鼠點一次，不重試（e2e/support/graph.ts）。
import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, s, switchIdentity } from "./support/app";
import { reviewer } from "./support/client";
import { clickableNode, clickNodeOnce, neighborsOf, selectedNodes, waitForGraphIdle, type ClickableNode, type Cy } from "./support/graph";

interface Snapshot {
  // 已展開路徑上第一個與第二個節點的候選：a 與 b 相連，b 還有 a 以外的鄰居
  a: string;
  b: string;
  dimmed: string[];
  selected: string[];
  // 每個節點的鄰居（不分方向）
  neighbors: Record<string, string[]>;
  labels: Record<string, string>;
}

// 圖的狀態：哪些節點變灰、選取了哪個，以及挑出可展開兩層的 a → b
async function snapshot(page: Page): Promise<Snapshot | null> {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(".graph-page .graph-canvas");
    const cy = container?._cyreg?.cy;
    if (cy === undefined || cy.nodes().length === 0) return null;
    const ids = cy.nodes().map((n) => n.id());
    const neighbors = Object.fromEntries(ids.map((id) => [id, cy.$id(id).neighborhood("node").map((n) => n.id())]));
    const labels = Object.fromEntries(ids.map((id) => [id, cy.$id(id).data("label")]));
    const a = ids.find((id) => neighbors[id].some((b) => neighbors[b].some((c) => c !== id)));
    if (a === undefined) return null;
    const b = neighbors[a].find((id) => neighbors[id].some((c) => c !== a))!;
    return {
      a,
      b,
      dimmed: ids.filter((id) => cy.$id(id).hasClass("dimmed")),
      selected: ids.filter((id) => cy.$id(id).hasClass("selected")),
      neighbors,
      labels,
    };
  });
}

const CANVAS = ".graph-page .graph-canvas";

// 等畫面移動結束後點一次節點，確認選取的是該節點
async function clickNode(page: Page, id: string): Promise<void> {
  await waitForGraphIdle(page, CANVAS);
  await clickNodeOnce(page, CANVAS, id);
  await expect.poll(() => selectedNodes(page, CANVAS)).toEqual([id]);
}

const sorted = (ids: string[]) => [...ids].sort();
const trail = (page: Page) => page.getByRole("navigation", { name: s.graphExpanded });

test("逐步展開：聚焦在節點與直接相連的節點，其他變灰；累積展開、點路徑回到該層、回到全部", async ({ page }) => {
  await openApp(page);
  if (reviewer !== undefined) await switchIdentity(page, reviewer.id);
  await openTab(page, s.tabGraph);
  await expect(page.locator(".graph-page .graph-canvas canvas").first()).toBeVisible();
  await page.locator(".graph-page .graph-canvas").scrollIntoViewIfNeeded();

  let state: Snapshot | null = null;
  await expect(async () => {
    state = await snapshot(page);
    expect(state, "圖中沒有可以展開兩層的節點").not.toBeNull();
  }).toPass();
  const { a, b, neighbors, labels } = state!;
  const ids = Object.keys(neighbors);
  // 全部：沒有變灰、沒有已展開的路徑
  expect(state!.dimmed).toEqual([]);
  await expect(trail(page)).toHaveCount(0);

  // 點 a：聚焦在 a 與它的鄰居
  await clickNode(page, a);
  const firstFocus = new Set([a, ...neighbors[a]]);
  expect(sorted((await snapshot(page))!.dimmed)).toEqual(sorted(ids.filter((id) => !firstFocus.has(id))));
  await expect(trail(page).getByRole("listitem")).toHaveText([labels[a]]);
  await expect(page.getByRole("region", { name: labels[a] })).toBeVisible();

  // 點 b（a 的鄰居）：從 b 繼續展開，路徑累積
  await clickNode(page, b);
  const secondFocus = new Set([a, b, ...neighbors[a], ...neighbors[b]]);
  expect(sorted((await snapshot(page))!.dimmed)).toEqual(sorted(ids.filter((id) => !secondFocus.has(id))));
  await expect(trail(page).getByRole("listitem")).toHaveText([labels[a], labels[b]]);
  await expect(trail(page).locator("[aria-current]")).toHaveText(labels[b]);

  // 點路徑的第一段：回到 a 那一層
  await trail(page).getByRole("button", { name: labels[a], exact: true }).click();
  await expect(trail(page).getByRole("listitem")).toHaveText([labels[a]]);
  expect((await snapshot(page))!.selected).toEqual([a]);

  // 只看 b（面板中點 b 從它繼續展開，再按只看它）
  await clickNode(page, b);
  await page.getByRole("region", { name: labels[b] }).getByRole("button", { name: s.graphShowOnly }).click();
  await expect(trail(page).getByRole("listitem")).toHaveText([labels[b]]);

  // 回到全部：沒有變灰、沒有選取
  await trail(page).getByRole("button", { name: s.graphShowAll }).click();
  await expect(trail(page)).toHaveCount(0);
  const all = (await snapshot(page))!;
  expect(all.dimmed).toEqual([]);
  expect(all.selected).toEqual([]);
  // 桌機（預設 1280×720）沒有選取時沒有實體欄，畫布佔滿寬度（#336）
  await expect(page.locator(".graph-entity-column")).toHaveCount(0);
});

// 「已展開」那一列出現時畫布不能移動，否則 cytoscape 以舊的容器位置換算滑鼠座標，之後的點擊落在別的地方。
// 這裡不捲動、不重試：點第一個節點、等畫面移動結束，再以 renderedPosition() 換算的座標點一次相連的節點
test("點第一個節點後，以畫面上的位置點相連的節點會選取該節點（不捲動、不重試）", async ({ page }) => {
  await openApp(page);
  if (reviewer !== undefined) await switchIdentity(page, reviewer.id);
  await openTab(page, s.tabGraph);
  await waitForGraphIdle(page, CANVAS);
  const box = await page.locator(CANVAS).boundingBox();

  // 第一個節點：有鄰居、在畫面上點得到
  const ids = await page.evaluate((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)?._cyreg?.cy;
    return cy === undefined ? [] : cy.nodes().map((n) => n.id());
  }, CANVAS);
  let first: ClickableNode | null = null;
  for (const id of ids) {
    if ((await neighborsOf(page, CANVAS, id)).length === 0) continue;
    first = await clickableNode(page, CANVAS, [id]);
    if (first !== null) break;
  }
  expect(first, "畫面上沒有點得到、而且有鄰居的節點").not.toBeNull();
  await page.mouse.click(first!.x, first!.y);
  await expect.poll(() => selectedNodes(page, CANVAS)).toEqual([first!.id]);
  await expect(trail(page)).toBeVisible();
  // 「已展開」那一列出現後，畫布的位置不變
  expect(await page.locator(CANVAS).boundingBox()).toEqual(box);

  await waitForGraphIdle(page, CANVAS);
  const second = await clickableNode(page, CANVAS, await neighborsOf(page, CANVAS, first!.id));
  expect(second, "畫面上沒有點得到的相連節點").not.toBeNull();
  await page.mouse.click(second!.x, second!.y);
  await expect.poll(() => selectedNodes(page, CANVAS)).toEqual([second!.id]);
  await expect(trail(page).getByRole("listitem")).toHaveText([first!.label, second!.label]);
});
