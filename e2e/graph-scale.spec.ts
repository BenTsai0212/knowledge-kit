// 大量節點時的圖譜（#254，docs/design.md「大量節點時的圖譜」）：E2E 只用客戶自己的資料（參考情境）驗證
// 「門檻以下維持現行（全部節點＋標籤）」與清單模式的分群（#254 決定 4）；門檻以上的三層導覽以單元測試與 app/tests/fixtures/large-graph.ts 驗證。
// 期望值以 oracle（e2e/support/dataset.ts 的 visibleGraph()）算出每個身分看得到的圖，再套用與 app 相同的 scaleMode()／clusterGraph()（#247）。
import { expect, test, type Page } from "@playwright/test";
import { clusterGraph, OTHER_CLUSTER, scaleMode } from "../app/src/graph/clusters";
import { openApp, openTab, s, switchIdentity } from "./support/app";
import { access, knowledgeModel, language } from "./support/client";
import { entityNames, visibleGraph } from "./support/dataset";
import { waitForGraphIdle, type Cy } from "./support/graph";

const CANVAS = ".graph-page .graph-canvas";
const k = s.graphKeyboard;
const z = s.graphZoom;

// 看不到任何實體的身分是空狀態（回傳 false）；其他身分的畫面由呼叫端以會重試的斷言等待
async function graphShown(page: Page, entities: number): Promise<boolean> {
  if (entities > 0) return true;
  await expect(page.locator(".empty-state")).toBeVisible();
  return false;
}

const mobile = (page: Page) => (page.viewportSize()?.width ?? Infinity) <= 600;

test("門檻以下維持現行：畫出看得到的全部節點，沒有層級麵包屑；門檻以上從全覽開始（只算目前身分看得到的，#247）", async ({ page }) => {
  await openApp(page);
  await openTab(page, s.tabGraph);
  for (const role of access.roles) {
    await switchIdentity(page, role.id);
    const graph = visibleGraph(role.id);
    if (!(await graphShown(page, graph.entities.length))) continue;
    const crumbs = page.getByRole("navigation", { name: z.breadcrumb });
    if (scaleMode(graph.entities.length, mobile(page)) === "all") {
      // 切換身分後換掉節點：數到看得到的實體數為止
      await expect
        .poll(() => page.evaluate((selector) => document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)?._cyreg?.cy?.nodes().length ?? 0, CANVAS), {
          message: role.id,
        })
        .toBe(graph.entities.length);
      await waitForGraphIdle(page, CANVAS);
      await expect(page.getByTestId("graph-zoom")).toHaveCount(0);
      await expect(crumbs).toHaveCount(0);
    } else {
      await expect(page.getByTestId("graph-zoom")).toBeVisible();
      await expect(crumbs).toBeVisible();
    }
  }
});

test("清單模式的群組是分群（容器類型／社群偵測／其他），群組與實體只來自目前身分看得到的（#254、#247）", async ({ page }) => {
  await openApp(page);
  await openTab(page, s.tabGraph);
  await page.getByRole("group", { name: k.modeLabel }).getByRole("button", { name: k.modeList }).click();
  const list = page.getByRole("region", { name: k.listLabel });
  let checked = 0;
  for (const role of access.roles) {
    await switchIdentity(page, role.id);
    const graph = visibleGraph(role.id);
    if (!(await graphShown(page, graph.entities.length))) continue;
    const { clusters } = clusterGraph(graph, knowledgeModel);
    const nameOf = (id: string) => {
      const e = graph.entities.find((x) => x.id === id)!;
      return e.names[language] || e.name;
    };
    // 群組名稱：容器或代表實體的名稱（同名時加上消歧，這裡不比對）、「其他」用 client/i18n/ 的名稱
    const unique = (id: string) => graph.entities.filter((e) => (e.names[language] || e.name) === nameOf(id)).length === 1;
    const expected = clusters.map((c) => (c.id === OTHER_CLUSTER ? z.other : unique(c.anchor!) ? nameOf(c.anchor!) : null));
    // 切換身分後清單換成新的內容：重試到群組名稱符合為止（前一個身分的清單可能還在）
    const headings = async () => (await list.getByRole("heading", { level: 3 }).allInnerTexts()).map((t) => t.trim());
    await expect
      .poll(async () => (await headings()).map((t, i) => (expected[i] === null ? null : t)), { message: role.id })
      .toEqual(expected);
    // 每個看得到的實體正好列一次；看不到的實體不成為群組名稱
    await expect(list.locator(":scope > section > ul > li")).toHaveCount(graph.entities.length);
    const shown = await headings();
    const hidden = new Set(entityNames(role.id, language).hidden);
    expect(shown.filter((t) => hidden.has(t)), role.id).toEqual([]);
    checked++;
  }
  // 防止以「每個身分都是空狀態」通過
  expect(checked).toBeGreaterThan(0);
});
