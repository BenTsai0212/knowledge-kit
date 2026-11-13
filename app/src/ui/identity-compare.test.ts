// 身分對照的畫面（#261）：欄的順序與目前身分、目前的題目、依序送出、快捷鍵 C／Esc
import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { columnStarted, compareColumns, compareKey, compareQuestion, isTextEntry } from "./identity-compare";

const { access, client } = clientConfig;
const language = client.defaultLanguage;

describe("compareColumns", () => {
  it("依 access.json 的身分順序，每個身分一欄（參考情境 3 欄），只有目前身分標為 current", () => {
    for (const role of access.roles) {
      const columns = compareColumns(access, role.id, language);
      expect(columns.map((c) => c.role)).toEqual(access.roles.map((r) => r.id));
      expect(columns.map((c) => c.label)).toEqual(access.roles.map((r) => r.label[language]));
      expect(columns.filter((c) => c.current).map((c) => c.role)).toEqual([role.id]);
    }
    expect(access.roles).toHaveLength(3);
  });
});

describe("compareQuestion", () => {
  it("目前身分的對話中最後一題；沒有題目時是 null", () => {
    expect(compareQuestion([])).toBeNull();
    expect(compareQuestion([{ question: "a" }, { question: "b" }])).toBe("b");
  });
});

describe("columnStarted", () => {
  it("前面的欄都有結果後才送出：一欄一欄", () => {
    expect([0, 1, 2].map((i) => columnStarted(i, 0))).toEqual([true, false, false]);
    expect([0, 1, 2].map((i) => columnStarted(i, 1))).toEqual([true, true, false]);
    expect([0, 1, 2].map((i) => columnStarted(i, 3))).toEqual([true, true, true]);
  });
});

describe("compareKey", () => {
  const key = (k: string, target: Parameters<typeof isTextEntry>[0] = null, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
    target,
  });

  it("C（大小寫）開關對照；Esc 只在打開時關閉", () => {
    expect(compareKey(key("c"), false)).toBe("toggle");
    expect(compareKey(key("C"), true)).toBe("toggle");
    expect(compareKey(key("Escape"), true)).toBe("close");
    expect(compareKey(key("Escape"), false)).toBeNull();
    expect(compareKey(key("x"), true)).toBeNull();
  });

  it("有 Ctrl／Meta／Alt 時不處理（複製等交給瀏覽器）", () => {
    expect(compareKey(key("c", null, { ctrlKey: true }), false)).toBeNull();
    expect(compareKey(key("c", null, { metaKey: true }), false)).toBeNull();
    expect(compareKey(key("c", null, { altKey: true }), false)).toBeNull();
  });

  it("焦點在文字輸入時不處理；身分的 radio 與按鈕仍是快捷鍵", () => {
    for (const target of [{ tagName: "TEXTAREA" }, { tagName: "INPUT", type: "text" }, { tagName: "INPUT" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) {
      expect(compareKey(key("c", target), false)).toBeNull();
      expect(compareKey(key("Escape", target), true)).toBeNull();
    }
    for (const target of [{ tagName: "INPUT", type: "radio" }, { tagName: "BUTTON" }, { tagName: "BODY" }]) {
      expect(compareKey(key("c", target), false)).toBe("toggle");
    }
  });
});
