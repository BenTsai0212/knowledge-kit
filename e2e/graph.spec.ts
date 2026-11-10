// 圖譜的逐步展開（#199，docs/graph.md「逐步展開」）：點節點聚焦、再點相連的節點累積展開、點路徑的一段回到該層、回到全部。
// 圖譜不呼叫模型。節點以 cytoscape 的實例（容器的 _cyreg）取得在畫面上的位置後以滑鼠點擊。
import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, s, switchIdentity } from "./support/app";
import { reviewer } from "./support/client";

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

type Cy = {
  nodes(): { length: number; map<T>(fn: (n: CyNode) => T): T[] };
  $id(id: string): CyNode;
};
type CyNode = {
  id(): string;
  hasClass(name: string): boolean;
  data(key: string): string;
  renderedPosition(): { x: number; y: number };
  neighborhood(selector: string): { map<T>(fn: (n: CyNode) => T): T[] };
};

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

// 點節點；畫面平滑移動時位置還會變，整段讀取與點擊一起重試，直到選取了該節點
async function clickNode(page: Page, id: string): Promise<void> {
  await expect(async () => {
    const point = await page.evaluate((target) => {
      const container = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(".graph-page .graph-canvas");
      const cy = container?._cyreg?.cy;
      if (container == null || cy === undefined) return null;
      const box = container.getBoundingClientRect();
      const position = cy.$id(target).renderedPosition();
      return { x: box.left + position.x, y: box.top + position.y };
    }, id);
    expect(point).not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
    expect((await snapshot(page))?.selected).toEqual([id]);
  }).toPass({ timeout: 10_000 });
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
  await expect(page.getByText(s.selectEntity)).toBeVisible();
});
