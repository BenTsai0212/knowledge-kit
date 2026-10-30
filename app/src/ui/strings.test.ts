import { describe, expect, it } from "vitest";
import workerReadme from "../../../worker/README.md?raw";
import { clientConfig } from "../client/load";
import { errorMessage, fill, STRINGS, strings, taskErrorMessage } from "./strings";

// 巢狀物件攤平成 "errors.daily_limit" 這類鍵
const flatten = (value: object, prefix = ""): [string, unknown][] =>
  Object.entries(value).flatMap(([k, v]) => (typeof v === "object" && v !== null ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));

describe("介面文字", () => {
  it("client.json 的每種語言都有，且與 STRINGS 的語言一致", () => {
    expect(Object.keys(STRINGS).sort()).toEqual([...clientConfig.client.languages].sort());
  });

  it("每種語言的鍵相同，且沒有空字串", () => {
    const keys = flatten(STRINGS[clientConfig.client.defaultLanguage]).map(([k]) => k).sort();
    for (const [language, s] of Object.entries(STRINGS)) {
      const entries = flatten(s);
      expect(entries.map(([k]) => k).sort(), language).toEqual(keys);
      expect(entries.filter(([, v]) => typeof v !== "string" || v.trim() === ""), language).toEqual([]);
    }
  });

  it("沒有的語言拋錯", () => {
    expect(() => strings("ja")).toThrow("沒有介面文字的語言：ja");
    expect(() => strings("toString")).toThrow("沒有介面文字的語言");
  });
});

describe("錯誤訊息", () => {
  it("worker/README.md 錯誤類型表中的每一種都有訊息", () => {
    const table = workerReadme.slice(workerReadme.indexOf("### 錯誤類型"), workerReadme.indexOf("### log"));
    const types = [...table.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(types).toHaveLength(15);
    for (const s of Object.values(STRINGS)) expect(Object.keys(s.errors)).toEqual(expect.arrayContaining(types));
  });

  it("依類型回訊息，不認得的類型用通用訊息", () => {
    expect(errorMessage("zh-TW", "daily_limit")).toBe(STRINGS["zh-TW"].errors.daily_limit);
    expect(errorMessage("en", "network")).toBe(STRINGS.en.errors.network);
    expect(errorMessage("zh-TW", "something_new")).toBe(STRINGS["zh-TW"].unknownError);
    expect(errorMessage("en", "toString")).toBe(STRINGS.en.unknownError);
  });

  it("萃取與比對的失敗原因：自己的原因用 extractErrors，其他依 /api/ask 的錯誤類型", () => {
    expect(taskErrorMessage("zh-TW", "format")).toBe(STRINGS["zh-TW"].extractErrors.format);
    expect(taskErrorMessage("en", "no_access_code")).toBe(STRINGS.en.extractErrors.no_access_code);
    expect(taskErrorMessage("en", "daily_limit")).toBe(STRINGS.en.errors.daily_limit);
    expect(taskErrorMessage("zh-TW", "toString")).toBe(STRINGS["zh-TW"].unknownError);
  });
});

describe("fill", () => {
  it("換掉 {key}，不解讀替換字元（標題以文字顯示）", () => {
    expect(fill(STRINGS["zh-TW"].conflictMarks.superseded_by, "title", "青翼進度")).toBe("已由〈青翼進度〉取代");
    expect(fill("{title}", "title", "$& $1")).toBe("$& $1");
  });

  it("每種語言的標示範本都有 {title}", () => {
    for (const s of Object.values(STRINGS)) for (const t of Object.values(s.conflictMarks)) expect(t).toContain("{title}");
  });
});
