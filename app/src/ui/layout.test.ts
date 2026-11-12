import { describe, expect, it } from "vitest";
import { layoutFor, NAV_ICONS, phoneTabs, sheetDragCloses, usesSegmented } from "./layout";
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

  it("展示模式：只有問答與圖譜，改用分段切換", () => {
    for (const canReview of [false, true]) {
      const views = visibleViews(canReview, off, true, true);
      expect(phoneTabs(views)).toEqual({ tabs: ["qa", "graph"], more: [] });
      expect(usesSegmented(views)).toBe(true);
    }
    expect(usesSegmented(visibleViews(false, off, false, false))).toBe(false);
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
