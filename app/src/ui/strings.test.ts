import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { STRINGS, strings } from "./strings";

describe("介面文字", () => {
  it("client.json 的每種語言都有，且與 STRINGS 的語言一致", () => {
    expect(Object.keys(STRINGS).sort()).toEqual([...clientConfig.client.languages].sort());
  });

  it("每種語言的鍵相同，且沒有空字串", () => {
    const keys = Object.keys(STRINGS[clientConfig.client.defaultLanguage]).sort();
    for (const [language, s] of Object.entries(STRINGS)) {
      expect(Object.keys(s).sort(), language).toEqual(keys);
      expect(Object.entries(s).filter(([, v]) => v.trim() === ""), language).toEqual([]);
    }
  });

  it("沒有的語言拋錯", () => {
    expect(() => strings("ja")).toThrow("沒有介面文字的語言：ja");
    expect(() => strings("toString")).toThrow("沒有介面文字的語言");
  });
});
