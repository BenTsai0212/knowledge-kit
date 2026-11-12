import { describe, expect, it } from "vitest";
import { crossFade, type TransitionDocument } from "./cross-fade";

// 切換語言、Light／Dark 的交叉淡換（#246）
describe("crossFade", () => {
  const fakeDocument = () => {
    const started: (() => void)[] = [];
    const doc: TransitionDocument = {
      startViewTransition(update) {
        started.push(update);
        update();
        return { ready: Promise.reject(new Error("skipped")) };
      },
    };
    return { doc, started };
  };

  it("支援 View Transitions 時以它套用（舊畫面淡出、新畫面淡入）；被取代時不丟出錯誤", async () => {
    const { doc, started } = fakeDocument();
    let applied = 0;
    crossFade(() => applied++, false, doc);
    expect(started).toHaveLength(1);
    expect(applied).toBe(1);
    // ready 的 reject 已處理：沒有 unhandled rejection
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("減少動態效果時直接套用，不做轉場", () => {
    const { doc, started } = fakeDocument();
    let applied = 0;
    crossFade(() => applied++, true, doc);
    expect(started).toHaveLength(0);
    expect(applied).toBe(1);
  });

  it("瀏覽器不支援時直接套用", () => {
    let applied = 0;
    crossFade(() => applied++, false, {});
    expect(applied).toBe(1);
  });
});
