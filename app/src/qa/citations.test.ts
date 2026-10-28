import { describe, expect, it } from "vitest";
import { resolveCitations } from "./citations";

const NUMBERING = ["p-a", "p-b", "p-c"];

describe("resolveCitations", () => {
  it("把編號轉成段落 id，依第一次出現的順序、不重複", () => {
    expect(resolveCitations("A [2]。B [1][2]。", NUMBERING)).toEqual({ text: "A [2]。B [1][2]。", cited: ["p-b", "p-a"], dropped: [] });
  });

  it("[1, 3] 統一成 [1][3]", () => {
    expect(resolveCitations("A [1, 3].", NUMBERING)).toEqual({ text: "A [1][3].", cited: ["p-a", "p-c"], dropped: [] });
  });

  it("不存在的編號從文字中移除並記錄", () => {
    expect(resolveCitations("A [4]. B [0]. C [2][9].", NUMBERING)).toEqual({
      text: "A. B. C [2].",
      cited: ["p-b"],
      dropped: [4, 0, 9],
    });
    expect(resolveCitations("A [1, 7].", NUMBERING)).toEqual({ text: "A [1].", cited: ["p-a"], dropped: [7] });
  });

  it("沒有引用時 cited 為空", () => {
    expect(resolveCitations("沒有出處的回答。", NUMBERING)).toEqual({ text: "沒有出處的回答。", cited: [], dropped: [] });
  });

  it("不是編號的方括號保留", () => {
    expect(resolveCitations("見 [附件] 與 [a1]。", NUMBERING).text).toBe("見 [附件] 與 [a1]。");
  });
});
