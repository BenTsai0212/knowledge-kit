// 圖譜畫布（cytoscape）的操作（#199）：以容器上的實例（_cyreg）讀出節點在畫面上的位置，用滑鼠點擊。
// 點擊只點一次、不重試：cytoscape 換算滑鼠座標時用的容器位置若是舊的，點擊會落在別的地方，重試會遮住這個問題。
import { expect, type Page } from "@playwright/test";

type Box = { x1: number; y1: number; x2: number; y2: number };
type CyNode = {
  id(): string;
  hasClass(name: string): boolean;
  data(key: string): string;
  animated(): boolean;
  renderedPosition(): { x: number; y: number };
  renderedBoundingBox(options: { includeLabels: boolean }): Box;
  neighborhood(selector: string): { map<T>(fn: (n: CyNode) => T): T[] };
};
export type Cy = {
  animated(): boolean;
  nodes(): { length: number; map<T>(fn: (n: CyNode) => T): T[] };
  elements(): { some(fn: (e: { animated(): boolean }) => boolean): boolean };
  $id(id: string): CyNode;
};

export interface ClickableNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

// canvas：畫布容器的 CSS selector（例如 ".graph-page .graph-canvas"）

// 等畫面移動與描線結束（節點大小的 transition 不改變位置，不必等）
export async function waitForGraphIdle(page: Page, canvas: string): Promise<void> {
  await page.waitForFunction((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)?._cyreg?.cy;
    return cy !== undefined && cy.nodes().length > 0 && !cy.animated() && !cy.elements().some((e) => e.animated());
  }, canvas);
}

// 畫布中選取（selected class）的節點
export async function selectedNodes(page: Page, canvas: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)?._cyreg?.cy;
    return cy === undefined
      ? []
      : cy
          .nodes()
          .map((n) => n.id())
          .filter((id) => cy.$id(id).hasClass("selected"));
  }, canvas);
}

// 候選節點中第一個可以直接點到的節點（候選為 null 時從所有節點中找）：中心點在視窗與畫布內、沒有被其他元素或節點蓋住。
// 回傳的座標由 renderedPosition() 加上容器目前的位置換算，與使用者看到的位置相同
export async function clickableNode(page: Page, canvas: string, candidates: string[] | null): Promise<ClickableNode | null> {
  return page.evaluate(
    ({ selector, candidates }) => {
      const container = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector);
      const cy = container?._cyreg?.cy;
      if (container == null || cy === undefined) return null;
      const box = container.getBoundingClientRect();
      const ids = cy.nodes().map((n) => n.id());
      const inside = (b: Box, x: number, y: number) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
      for (const id of candidates ?? ids) {
        const { x, y } = cy.$id(id).renderedPosition();
        const [px, py] = [box.left + x, box.top + y];
        if (px < box.left || px > box.right || py < box.top || py > box.bottom) continue;
        if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) continue;
        if (!container.contains(document.elementFromPoint(px, py))) continue;
        if (ids.some((other) => other !== id && inside(cy.$id(other).renderedBoundingBox({ includeLabels: false }), x, y))) continue;
        return { id, label: cy.$id(id).data("label"), x: px, y: py };
      }
      return null;
    },
    { selector: canvas, candidates },
  );
}

// 節點的鄰居（不分方向）
export async function neighborsOf(page: Page, canvas: string, id: string): Promise<string[]> {
  return page.evaluate(
    ({ selector, id }) => {
      const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)?._cyreg?.cy;
      return cy === undefined
        ? []
        : cy
            .$id(id)
            .neighborhood("node")
            .map((n) => n.id());
    },
    { selector: canvas, id },
  );
}

// 在節點目前的位置點一次（不重試）
export async function clickNodeOnce(page: Page, canvas: string, id: string): Promise<void> {
  const node = await clickableNode(page, canvas, [id]);
  expect(node, `節點 ${id} 不在畫面上或被蓋住`).not.toBeNull();
  await page.mouse.click(node!.x, node!.y);
}
