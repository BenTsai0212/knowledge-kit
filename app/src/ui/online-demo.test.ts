import { describe, expect, it } from "vitest";
import { onlineDemo, readOnlineDemo, visibleViews } from "./online-demo";

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

describe("visibleViews", () => {
  const off = { enabled: false };
  const on = { enabled: true };

  it("待審與評測台只給 canReview 的身分", () => {
    expect(visibleViews(false, off)).toEqual(["qa", "graph", "timeline", "upload"]);
    expect(visibleViews(true, off)).toEqual(["qa", "graph", "timeline", "upload", "review", "evals"]);
  });

  it("線上 demo 只隱藏評測台，上傳與待審保留", () => {
    expect(visibleViews(false, on)).toEqual(["qa", "graph", "timeline", "upload"]);
    expect(visibleViews(true, on)).toEqual(["qa", "graph", "timeline", "upload", "review"]);
  });
});
