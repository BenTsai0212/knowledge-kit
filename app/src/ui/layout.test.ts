import { describe, expect, it } from "vitest";
import { layoutFor, NAV_ICONS, phoneTabs, SHEET_HALF, sheetDragCloses, sheetSnap, visibleArea } from "./layout";
import { visibleViews } from "./online-demo";

const off = { enabled: false };

describe("layoutFor（docs/design.md「斷點」）", () => {
  it("≤ 600 手機、601–1024 平板、≥ 1025 桌機", () => {
    expect([320, 390, 600, 601, 820, 1024, 1025, 1280].map(layoutFor)).toEqual(["phone", "phone", "phone", "tablet", "tablet", "tablet", "desktop", "desktop"]);
  });
});

describe("phoneTabs（docs/design.md「日常工具 › 手機」）", () => {
  it("一般員工：首頁、問答、圖譜、時間軸、上傳，沒有「更多」", () => {
    expect(phoneTabs(visibleViews(false, off, false, false))).toEqual({ tabs: ["home", "qa", "graph", "timeline", "upload"], more: [] });
  });

  it("主管：首頁、問答、圖譜、上傳＋更多（時間軸、待審）", () => {
    expect(phoneTabs(visibleViews(true, off, false, false))).toEqual({ tabs: ["home", "qa", "graph", "upload"], more: ["timeline", "review"] });
  });

  it("主管開啟評測台：「更多」是時間軸、待審、評測台", () => {
    expect(phoneTabs(visibleViews(true, off, false, true))).toEqual({ tabs: ["home", "qa", "graph", "upload"], more: ["timeline", "review", "evals"] });
  });

  it("線上 demo 的主管：評測台不出現在「更多」", () => {
    expect(phoneTabs(visibleViews(true, { enabled: true }, false, true)).more).toEqual(["timeline", "review"]);
  });

  it("每個頁籤與「更多」都有圖示", () => {
    for (const view of [...visibleViews(true, off, false, true), "more" as const]) expect(NAV_ICONS[view]).toMatch(/^M/);
  });
});

describe("sheetDragCloses（底部面板往下拖曳）", () => {
  it("超過面板高度的 1/4（最多 96px）才關閉", () => {
    expect(sheetDragCloses(95, 800)).toBe(false);
    expect(sheetDragCloses(96, 800)).toBe(true);
    expect(sheetDragCloses(49, 200)).toBe(false);
    expect(sheetDragCloses(50, 200)).toBe(true);
  });

  it("往上拖或沒有移動時不關閉", () => {
    expect(sheetDragCloses(0, 0)).toBe(false);
    expect(sheetDragCloses(-200, 400)).toBe(false);
  });
});

describe("sheetSnap（可展開的底部面板，#257）", () => {
  it("停在 56% 時：往上拉過門檻到全高，往下拉過門檻關閉，否則彈回", () => {
    expect(sheetSnap("half", -96, 470)).toBe("full");
    expect(sheetSnap("half", -95, 470)).toBe("half");
    expect(sheetSnap("half", 96, 470)).toBe("close");
    expect(sheetSnap("half", 95, 470)).toBe("half");
    expect(sheetSnap("half", 0, 470)).toBe("half");
  });

  it("全高時：往下拉過門檻回到 56%（不直接關閉），往上拉不變", () => {
    expect(sheetSnap("full", 96, 844)).toBe("half");
    expect(sheetSnap("full", 400, 844)).toBe("half");
    expect(sheetSnap("full", 95, 844)).toBe("full");
    expect(sheetSnap("full", -200, 844)).toBe("full");
  });

  it("面板很矮時門檻是高度的 1/4", () => {
    expect(sheetSnap("half", -50, 200)).toBe("full");
    expect(sheetSnap("half", 50, 200)).toBe("close");
  });
});

describe("visibleArea（實體面板以上的可見部分，#257）", () => {
  // 390×844：畫布從頂端列與工具列下方（y=120）延伸到分頁列（高 640）
  const canvas = { top: 120, width: 390, height: 640 };

  it("面板停在 56% 時，可見部分是畫布上緣到面板上緣", () => {
    expect(visibleArea(canvas, 844, SHEET_HALF)).toEqual({ width: 390, height: 844 * (1 - SHEET_HALF) - 120, top: 0 });
  });

  it("沒有面板、面板沒蓋到畫布或整個畫布都被蓋住時是整個畫布", () => {
    expect(visibleArea(canvas, 844, 0)).toEqual({ width: 390, height: 640, top: 0 });
    expect(visibleArea({ ...canvas, height: 100 }, 844, SHEET_HALF)).toEqual({ width: 390, height: 100, top: 0 });
    expect(visibleArea({ ...canvas, top: 500 }, 844, SHEET_HALF)).toEqual({ width: 390, height: 640, top: 0 });
  });

  it("畫布上方浮著一列（已展開）時，面板開著的可見部分從這一列下緣開始（#357 修正要求）", () => {
    const above = 844 * (1 - SHEET_HALF) - 120;
    expect(visibleArea(canvas, 844, SHEET_HALF, 54)).toEqual({ width: 390, height: above - 54, top: 54 });
    // 沒有面板時不扣；扣掉後沒有剩下高度時不扣
    expect(visibleArea(canvas, 844, 0, 54)).toEqual({ width: 390, height: 640, top: 0 });
    expect(visibleArea(canvas, 844, SHEET_HALF, above + 1)).toEqual({ width: 390, height: above, top: 0 });
  });
});
