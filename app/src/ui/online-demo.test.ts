import { describe, expect, it } from "vitest";
import { onlineDemo, presentationMode, readOnlineDemo, readPresentationMode, visibleViews } from "./online-demo";

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

describe("visibleViews", () => {
  const off = { enabled: false };
  const on = { enabled: true };

  it("待審與評測台只給 canReview 的身分", () => {
    expect(visibleViews(false, off, false)).toEqual(["qa", "graph", "timeline", "upload"]);
    expect(visibleViews(true, off, false)).toEqual(["qa", "graph", "timeline", "upload", "review", "evals"]);
  });

  it("線上 demo 只隱藏評測台，上傳與待審保留", () => {
    expect(visibleViews(false, on, false)).toEqual(["qa", "graph", "timeline", "upload"]);
    expect(visibleViews(true, on, false)).toEqual(["qa", "graph", "timeline", "upload", "review"]);
  });

  it("展示模式只有問答與圖譜，canReview 的身分也一樣", () => {
    expect(visibleViews(false, off, true)).toEqual(["qa", "graph"]);
    expect(visibleViews(true, off, true)).toEqual(["qa", "graph"]);
  });

  it("與線上 demo 同時開啟時取兩者的交集", () => {
    for (const canReview of [false, true]) {
      const both = visibleViews(canReview, on, true);
      expect(both).toEqual(["qa", "graph"]);
      const demoOnly = visibleViews(canReview, on, false);
      const presentationOnly = visibleViews(canReview, off, true);
      expect(both).toEqual(demoOnly.filter((v) => presentationOnly.includes(v)));
    }
  });
});
