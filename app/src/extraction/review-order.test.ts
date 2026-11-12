import { describe, expect, it } from "vitest";
import { appearanceKey, byAppearance, namePosition } from "./review-order";

describe("待審區的排列（#243 PR 3 審查）", () => {
  const passage = { ordinal: 0, content: "營運部經理張雅婷宣布第二階段啟動。" };

  it("名稱在段落中最早出現的位置；不分大小寫，找不到時排在最後", () => {
    expect(namePosition(passage.content, ["張雅婷", "Yating Chang"])).toBe(5);
    expect(namePosition("Operations team", ["operations"])).toBe(0);
    expect(namePosition(passage.content, ["不存在", ""])).toBe(Number.POSITIVE_INFINITY);
  });

  it("依第一個出處段落、名稱的位置排列，與 id 無關；沒有出處的排在最後", () => {
    const items = [
      { id: "pe-a", key: appearanceKey(passage, [["張雅婷"]]) },
      { id: "pe-b", key: appearanceKey({ ordinal: 1, content: "第二段" }, [["第二段"]]) },
      { id: "pe-c", key: appearanceKey(undefined, [["沒有出處"]]) },
      { id: "pe-d", key: appearanceKey(passage, [["營運部"]]) },
    ];
    expect(byAppearance(items, (x) => x.key).map((x) => x.id)).toEqual(["pe-d", "pe-a", "pe-b", "pe-c"]);
  });

  it("位置相同時依 id，順序固定；不改動傳入的陣列", () => {
    const items = [
      { id: "pr-2", key: [0, 5, 0] },
      { id: "pr-1", key: [0, 5, 0] },
    ];
    expect(byAppearance(items, (x) => x.key).map((x) => x.id)).toEqual(["pr-1", "pr-2"]);
    expect(items.map((x) => x.id)).toEqual(["pr-2", "pr-1"]);
  });
});
