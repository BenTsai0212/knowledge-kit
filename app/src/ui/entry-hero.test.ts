import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import css from "./app.css?raw";
import { sources } from "../client/source-scan";
import { FORMING_COUNT, HERO_COUNTS, HERO_LITE_COUNTS, heroScene, heroShape, isLowEnd, nearestLinks, scatter, seededRandom } from "./entry-hero";

const input = { entities: dataset.entities.entities, relations: dataset.relations.relations, types: clientConfig.knowledgeModel.entityTypes };
const hero = sources.find(([p]) => p === "../ui/EntryHero.tsx")?.[1] ?? "";
const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");
const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;

describe("入口頁主視覺的版面", () => {
  const scene = heroScene(input);

  it("前景是客戶資料的實體與關係（兩端都在前景），形狀依類型", () => {
    expect(scene.front.map((n) => n.id).sort()).toEqual(input.entities.slice(0, HERO_COUNTS.front).map((e) => e.id).sort());
    const ids = new Set(scene.front.map((n) => n.id));
    const expected = input.relations.filter((r) => ids.has(r.from) && ids.has(r.to)).length;
    expect(scene.links.length).toBeGreaterThan(0);
    expect(scene.links.length).toBeLessThanOrEqual(expected);
    for (const n of scene.front) expect(n.shape).toBe(heroShape(input.types.find((t) => t.id === n.type)?.icon));
    expect(scene.front.filter((n) => n.core)).toHaveLength(3);
  });

  it("換客戶時圖跟著換", () => {
    const other = heroScene({
      entities: [
        { id: "a", type: "x" },
        { id: "b", type: "y" },
        { id: "c", type: "x" },
      ],
      relations: [{ from: "a", to: "b" }],
      types: [
        { id: "x", icon: "person" },
        { id: "y", icon: "team" },
      ],
    });
    expect(other.front.map((n) => [n.id, n.shape])).toEqual([
      ["a", "circle"],
      ["b", "block"],
      ["c", "circle"],
    ]);
    expect(other.links).toEqual([{ from: 0, to: 1 }]);
    expect(other.forming.every((l) => !(l.from === 0 && l.to === 1))).toBe(true);
  });

  it("三層的數量、座標在畫面內、固定種子每次相同", () => {
    expect([scene.far.length, scene.mid.length]).toEqual([HERO_COUNTS.far, HERO_COUNTS.mid]);
    const lite = heroScene(input, true);
    expect([lite.far.length, lite.mid.length]).toEqual([HERO_LITE_COUNTS.far, HERO_LITE_COUNTS.mid]);
    expect([...scene.far, ...scene.mid, ...scene.front].every(inside)).toBe(true);
    expect(heroScene(input)).toEqual(scene);
  });

  it("新連線的兩端原本沒有關係，不重複", () => {
    expect(scene.forming).toHaveLength(FORMING_COUNT);
    const keys = (links: typeof scene.links) => links.map((l) => `${l.from}-${l.to}`);
    expect(new Set(keys(scene.forming)).size).toBe(FORMING_COUNT);
    expect(keys(scene.forming).filter((k) => keys(scene.links).includes(k))).toEqual([]);
  });

  it("遠景與中景連到最近的兩個鄰居，線不重複", () => {
    const points = scatter(12, seededRandom(1));
    const links = nearestLinks(points);
    const keys = links.map((l) => `${l.from}-${l.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    points.forEach((_, i) => expect(links.filter((l) => l.from === i || l.to === i).length).toBeGreaterThanOrEqual(2));
  });

  it("低階裝置：核心數或記憶體 4 以下；沒有資訊時視為一般裝置", () => {
    expect(isLowEnd({ hardwareConcurrency: 4 })).toBe(true);
    expect(isLowEnd({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe(true);
    expect(isLowEnd({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(false);
    expect(isLowEnd({})).toBe(false);
  });
});

describe("入口頁主視覺的畫法", () => {
  it("沒有文字，對輔助技術隱藏", () => {
    expect(hero).not.toMatch(/<text\b|strings\(/);
    expect(hero).toContain('aria-hidden="true"');
  });

  it("景深與擺動的數值與 docs/design.md 相同", () => {
    expect(cssText).toMatch(/\.hero \{[^}]*perspective: 1100px/);
    expect(cssText).toMatch(/\.hero__layer--far \{[^}]*translateZ\(-520px\)[^}]*blur\(1\.2px\)/);
    expect(cssText).toMatch(/\.hero__layer--mid \{[^}]*translateZ\(-220px\)/);
    expect(cssText).toMatch(/animation: kOrbit 26s/);
    expect(cssText).toMatch(/kForm 10s/);
    expect(FORMING_COUNT * 2.5).toBe(10);
  });

  it("減少動態時停止所有動畫，只留靜止的網路", () => {
    const reduced = cssText.split("@media (prefers-reduced-motion: reduce)").find((part) => part.includes(".hero *"));
    expect(reduced).toMatch(/\.hero \* \{\s*animation: none;/);
    expect(reduced).toMatch(/\.hero__travel,\s*\.hero__form,\s*\.hero__glow \{\s*display: none;/);
  });
});
