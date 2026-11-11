import { describe, expect, it } from "vitest";
import { unwrapAnswer } from "./unwrap";

const WRAPPED = "<citation_response>範例公司設有產品研發部、營運部、人資部與業務部四個部門 [1]。</citation_response>";
const INNER = "範例公司設有產品研發部、營運部、人資部與業務部四個部門 [1]。";

describe("unwrapAnswer：完成的回答", () => {
  it("移除整段回答外層成對的標籤（#237）", () => {
    expect(unwrapAnswer(WRAPPED, true)).toBe(INNER);
    expect(unwrapAnswer("<answer>\n一年有 7 天 [1]。\n</answer>\n", true)).toBe("一年有 7 天 [1]。");
    expect(unwrapAnswer('  <response lang="zh-TW">一年有 7 天 [1]。</response>', true)).toBe("一年有 7 天 [1]。");
  });

  it("巢狀的包裝一併移除", () => {
    expect(unwrapAnswer(`<answer>${WRAPPED}</answer>`, true)).toBe(INNER);
  });

  it("沒有標籤時不變", () => {
    for (const text of [INNER, "一年有 7 天 [1]。\n", "", "<5 人的部門 [1]。"]) expect(unwrapAnswer(text, true)).toBe(text);
  });

  it("內文中看似標籤的文字不移除", () => {
    for (const text of [
      "回答時用 <answer> 標籤 [1]。",
      "<b>重點</b>：一年有 7 天 [1]。",
      "<a>甲</a> 與 <a>乙</a>",
      "一年有 7 天 [1]。</answer>",
      "<answer>一年有 7 天 [1]。",
    ]) {
      expect(unwrapAnswer(text, true), text).toBe(text);
    }
    expect(unwrapAnswer("<answer>見 <b>第 3 條</b> [1]。</answer>", true)).toBe("見 <b>第 3 條</b> [1]。");
  });
});

describe("unwrapAnswer：串流中、中斷或截斷", () => {
  it("開頭標籤還沒收完時不顯示", () => {
    for (const text of ["<", " <", "<citation_", "<citation_response", '<response lang="zh']) expect(unwrapAnswer(text, false), text).toBe("");
  });

  it("開頭標籤收完後只顯示標籤之後的文字", () => {
    expect(unwrapAnswer("<citation_response>", false)).toBe("");
    expect(unwrapAnswer("<citation_response>範例公司設有", false)).toBe("範例公司設有");
    expect(unwrapAnswer("<answer><citation_", false)).toBe("");
  });

  it("結尾標籤還沒收完的部分不顯示", () => {
    expect(unwrapAnswer(`<citation_response>${INNER}<`, false)).toBe(INNER);
    expect(unwrapAnswer(`<citation_response>${INNER}</citation_`, false)).toBe(INNER);
    expect(unwrapAnswer(WRAPPED, false)).toBe(INNER);
  });

  it("沒有標籤時不變", () => {
    for (const text of ["一年", "一年有 7 天 [1]", "[[NO_"]) expect(unwrapAnswer(text, false)).toBe(text);
  });
});
