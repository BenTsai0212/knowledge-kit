import { describe, expect, it } from "vitest";
import { evalsMode, onlineDemo, presentationMode, readEvalsMode, readOnlineDemo, readPresentationMode, visibleViews, defaultView } from "./online-demo";

describe("readOnlineDemo", () => {
  it("預設關閉：未設定或不是 \"1\" 時都關閉，也不帶公開碼", () => {
    expect(readOnlineDemo({})).toEqual({ enabled: false, publicAccessCode: "" });
    for (const value of ["0", "true", "", " 1", true, 1]) {
      expect(readOnlineDemo({ VITE_ONLINE_DEMO: value, VITE_PUBLIC_ACCESS_CODE: "demo-code" })).toEqual({ enabled: false, publicAccessCode: "" });
    }
  });

  it("開啟時帶入公開碼（去掉前後空白）；沒有設定時為空字串", () => {
    expect(readOnlineDemo({ VITE_ONLINE_DEMO: "1", VITE_PUBLIC_ACCESS_CODE: " demo-code " })).toEqual({ enabled: true, publicAccessCode: "demo-code" });
    expect(readOnlineDemo({ VITE_ONLINE_DEMO: "1" })).toEqual({ enabled: true, publicAccessCode: "" });
  });

  it("測試環境沒有設定開關，所以是關閉的", () => {
    expect(onlineDemo.enabled).toBe(false);
  });
});

describe("readPresentationMode", () => {
  it("只有 mode=presentation 時開啟", () => {
    expect(readPresentationMode("?mode=presentation")).toBe(true);
    expect(readPresentationMode("mode=presentation")).toBe(true);
    expect(readPresentationMode("?lang=ja&mode=presentation")).toBe(true);
  });

  it("沒有參數、其他值或大小寫不同時關閉", () => {
    for (const search of ["", "?", "?mode", "?mode=", "?mode=demo", "?mode=Presentation", "?mode=PRESENTATION", "?MODE=presentation", "?mode=presentation%20", "?presentation"]) {
      expect(readPresentationMode(search)).toBe(false);
    }
  });

  it("測試環境沒有網址，所以是關閉的", () => {
    expect(presentationMode).toBe(false);
  });
});

describe("readEvalsMode", () => {
  it("只有 tools=evals 時開啟", () => {
    expect(readEvalsMode("?tools=evals")).toBe(true);
    expect(readEvalsMode("tools=evals")).toBe(true);
    expect(readEvalsMode("?lang=ja&tools=evals")).toBe(true);
    expect(readEvalsMode("?mode=presentation&tools=evals")).toBe(true);
  });

  it("沒有參數、其他值或大小寫不同時關閉", () => {
    for (const search of ["", "?", "?tools", "?tools=", "?tools=eval", "?tools=Evals", "?tools=EVALS", "?TOOLS=evals", "?tools=evals%20", "?evals", "?mode=evals"]) {
      expect(readEvalsMode(search)).toBe(false);
    }
  });

  it("測試環境沒有網址，所以是關閉的", () => {
    expect(evalsMode).toBe(false);
  });
});

describe("visibleViews", () => {
  const off = { enabled: false };
  const on = { enabled: true };

  it("待審只給 canReview 的身分；沒有 tools=evals 時，canReview 的身分也看不到評測台", () => {
    expect(visibleViews(false, off, false, false)).toEqual(["home", "qa", "graph", "timeline", "upload"]);
    expect(visibleViews(true, off, false, false)).toEqual(["home", "qa", "graph", "timeline", "upload", "review"]);
  });

  it("tools=evals 時評測台只給 canReview 的身分", () => {
    expect(visibleViews(false, off, false, true)).toEqual(["home", "qa", "graph", "timeline", "upload"]);
    expect(visibleViews(true, off, false, true)).toEqual(["home", "qa", "graph", "timeline", "upload", "review", "evals"]);
  });

  it("線上 demo 只隱藏評測台（tools=evals 也一樣），上傳與待審保留", () => {
    for (const evals of [false, true]) {
      expect(visibleViews(false, on, false, evals)).toEqual(["home", "qa", "graph", "timeline", "upload"]);
      expect(visibleViews(true, on, false, evals)).toEqual(["home", "qa", "graph", "timeline", "upload", "review"]);
    }
  });

  it("展示模式只有問答與圖譜，canReview 的身分與 tools=evals 也一樣", () => {
    for (const evals of [false, true]) {
      expect(visibleViews(false, off, true, evals)).toEqual(["qa", "graph"]);
      expect(visibleViews(true, off, true, evals)).toEqual(["qa", "graph"]);
    }
  });

  it("與線上 demo 同時開啟時取兩者的交集", () => {
    for (const canReview of [false, true]) {
      for (const evals of [false, true]) {
        const both = visibleViews(canReview, on, true, evals);
        expect(both).toEqual(["qa", "graph"]);
        const demoOnly = visibleViews(canReview, on, false, evals);
        const presentationOnly = visibleViews(canReview, off, true, evals);
        expect(both).toEqual(demoOnly.filter((v) => presentationOnly.includes(v)));
      }
    }
  });
});

describe("defaultView", () => {
  it("登入後先到首頁；展示模式直接進問答（#283）", () => {
    expect(defaultView(false)).toBe("home");
    expect(defaultView(true)).toBe("qa");
  });

  it("預設頁一定是看得到的頁籤", () => {
    for (const presentation of [false, true]) {
      for (const canReview of [false, true]) {
        expect(visibleViews(canReview, { enabled: false }, presentation, false)).toContain(defaultView(presentation));
      }
    }
  });
});
