import { describe, expect, it } from "vitest";
import workerReadme from "../../../worker/README.md?raw";
import { errorMessage, fill, strings, taskErrorMessage, TRANSLATIONS } from "./i18n";
import { i18nManifests } from "./keys";
import { clientConfig } from "./load";

// 巢狀物件攤平成 "errors.daily_limit" 這類鍵
const flatten = (value: object, prefix = ""): [string, unknown][] =>
  Object.entries(value).flatMap(([k, v]) => (typeof v === "object" && v !== null ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));

describe("翻譯檔（client/i18n/）", () => {
  it("每種語言一份，與 client.json 的 languages 一致", () => {
    expect(Object.keys(TRANSLATIONS).sort()).toEqual([...clientConfig.client.languages].sort());
  });

  it("每種語言的鍵與鍵清單（keys.ts）相同，且沒有空字串", () => {
    const keys = i18nManifests
      .flatMap((m) => Object.keys(m.keys).map((k) => (m.pointer ? `${m.pointer.replace("/properties/", "")}.${k}` : k)))
      .filter((k) => !i18nManifests.some((m) => m.pointer === `/properties/${k}`))
      .sort();
    for (const [language, s] of Object.entries(TRANSLATIONS)) {
      const entries = flatten(s);
      expect(entries.map(([k]) => k).sort(), language).toEqual(keys);
      expect(entries.filter(([, v]) => typeof v !== "string" || v.trim() === ""), language).toEqual([]);
    }
  });

  it("沒有的語言拋錯", () => {
    expect(() => strings("ja")).toThrow("No UI strings for language: ja");
    expect(() => strings("toString")).toThrow("No UI strings for language");
  });
});

describe("錯誤訊息", () => {
  it("worker/README.md 錯誤類型表中的每一種都有訊息", () => {
    const table = workerReadme.slice(workerReadme.indexOf("### 錯誤類型"), workerReadme.indexOf("### log"));
    const types = [...table.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(types).toHaveLength(15);
    for (const s of Object.values(TRANSLATIONS)) expect(Object.keys(s.errors)).toEqual(expect.arrayContaining(types));
  });

  it("依類型回訊息，不認得的類型用通用訊息", () => {
    expect(errorMessage("zh-TW", "daily_limit")).toBe(strings("zh-TW").errors.daily_limit);
    expect(errorMessage("en", "network")).toBe(strings("en").errors.network);
    expect(errorMessage("zh-TW", "something_new")).toBe(strings("zh-TW").unknownError);
    expect(errorMessage("en", "toString")).toBe(strings("en").unknownError);
  });

  it("萃取與比對的失敗原因：自己的原因用 extractErrors，其他依 /api/ask 的錯誤類型", () => {
    expect(taskErrorMessage("zh-TW", "format")).toBe(strings("zh-TW").extractErrors.format);
    expect(taskErrorMessage("en", "no_access_code")).toBe(strings("en").extractErrors.no_access_code);
    expect(taskErrorMessage("en", "daily_limit")).toBe(strings("en").errors.daily_limit);
    expect(taskErrorMessage("zh-TW", "toString")).toBe(strings("zh-TW").unknownError);
  });
});

describe("fill", () => {
  it("換掉 {key}，不解讀替換字元（標題以文字顯示）", () => {
    expect(fill(strings("zh-TW").conflictMarks.superseded_by, { title: "青翼進度" })).toBe("已由〈青翼進度〉取代");
    expect(fill("{title}", { title: "$& $1" })).toBe("$& $1");
  });

  it("多個參數一次代入；值中的 {…} 不再展開，沒有給值的參數保留原樣", () => {
    expect(fill("{done}/{total}", { done: 2, total: 3 })).toBe("2/3");
    expect(fill("{text} ({note})", { text: "{note}", note: "x" })).toBe("{note} (x)");
    expect(fill("{a} {b}", { a: "1" })).toBe("1 {b}");
    expect(fill("{toString}", {})).toBe("{toString}");
  });

  it("每種語言的標示範本都有 {title}", () => {
    for (const s of Object.values(TRANSLATIONS)) for (const t of Object.values(s.conflictMarks)) expect(t).toContain("{title}");
  });
});

// 結構測試：介面文字只來自 client/i18n/，元件不寫死文字（docs/client-config.md「翻譯檔」）。
// 只能檢查中日韓文字；寫死的英文介面文字由審查把關。
const sources = Object.entries(
  import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts"], { query: "?raw", import: "default", eager: true }),
);

// 去掉註解，保留字串、樣板字串、正規表達式與 JSX 文字（略過其中的 //、/* 與引號）
function stripComments(text: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === quote) quote = null;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "/" && /(^|[(,=:[!&|?{};]|\breturn)\s*$/.test(out.slice(-20))) {
      // 正規表達式：讀到字元類別外、未跳脫的 /
      let inClass = false;
      out += c;
      for (i++; i < text.length && text[i] !== "\n"; i++) {
        const r = text[i];
        out += r;
        if (r === "\\") out += text[++i] ?? "";
        else if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
      }
    } else {
      if (c === '"' || c === "'" || c === "`") quote = c;
      out += c;
    }
  }
  return out;
}

const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯]/;

// 允許中日韓文字的檔：都不是畫面上的文字（畫面依錯誤類型從翻譯檔取訊息，不顯示 Error.message）
const ALLOWED: Record<string, string> = {
  "../dataset/validate.ts": "資料集檢查的錯誤訊息，給開發者（與 check:client 相同）",
  "../dataset/seed.ts": "資料集檢查的錯誤訊息，給開發者",
  "../db/migrate.ts": "migration 的錯誤訊息，給開發者",
  "../db/test-fixtures.ts": "測試資料",
  "../retrieval/tokenize.ts": "中文的停用字",
  "../retrieval/providers.ts": "設定錯誤的訊息，給開發者",
  "../upload/chunk.ts": "切段用的句末標點",
  "../upload/parse.ts": "Error.message；畫面依 ParseFailure 顯示",
  "../upload/write.ts": "Error.message；畫面依 UploadFailure 顯示",
  "../extraction/output.ts": "Error.message；畫面依 ExtractFailure 顯示",
  "../extraction/store.ts": "Error.message；畫面依 reviewErrors 顯示",
  "../conflicts/output.ts": "Error.message；畫面依 ExtractFailure 顯示",
  "../qa/answer.ts": "console.warn，給開發者",
};

// 文字表：除了讀取模組與型別，不得有介面文字的型別或依語言分的物件
const TABLE = [/\bUiStrings\b/, /\bSTRINGS\b/, /["']zh-TW["']\s*:\s*\{/, /\ben\s*:\s*\{/];
const TABLE_OK = new Set(["./i18n.ts", "./types.ts", "./keys.ts"]);

describe("介面文字的結構", () => {
  it("掃描範圍包含元件與問答模組，不含測試", () => {
    const paths = sources.map(([p]) => p);
    expect(paths).toEqual(expect.arrayContaining(["../App.tsx", "../ui/ReviewPage.tsx", "../qa/answer.ts", "./i18n.ts"]));
    expect(paths.filter((p) => p.endsWith(".test.ts"))).toEqual([]);
  });

  it("stripComments 去掉註解，保留字串與正規表達式中的 // 與引號", () => {
    expect(stripComments('const a = "中"; // 註解\n/* 註解 */ b')).toBe('const a = "中"; \n b');
    expect(stripComments("const u = 'http://x'; // y")).toBe("const u = 'http://x'; \n");
    expect(stripComments("<p>{s.a}</p> // 註解")).toBe("<p>{s.a}</p> \n");
    expect(stripComments('x.replace(/[&"]/g, f); // 註解')).toBe('x.replace(/[&"]/g, f); \n');
    expect(stripComments("const r = /`[^`]*`/; // 註解\nconst d = a / b; // 註解")).toBe("const r = /`[^`]*`/; \nconst d = a / b; \n");
    expect(CJK.test(stripComments("<p>文字</p>"))).toBe(true);
  });

  it("只有 i18n.ts 讀取 client/i18n/", () => {
    const reads = /["'`][^"'`]*client\/i18n\//;
    expect(sources.filter(([, text]) => reads.test(stripComments(text))).map(([p]) => p)).toEqual(["./i18n.ts"]);
  });

  it("去掉註解後沒有中日韓文字（字串、JSX 文字、全形標點）", () => {
    const found = sources.filter(([p, text]) => !(p in ALLOWED) && CJK.test(stripComments(text))).map(([p]) => p);
    expect(found).toEqual([]);
  });

  it("例外清單中的檔都存在，且確實需要例外；元件與 App 不在清單中", () => {
    const byPath = Object.fromEntries(sources);
    for (const p of Object.keys(ALLOWED)) {
      expect(byPath[p], p).toBeDefined();
      expect(CJK.test(stripComments(byPath[p])), p).toBe(true);
    }
    expect(Object.keys(ALLOWED).filter((p) => p.startsWith("../ui/") || p === "../App.tsx")).toEqual([]);
  });

  it("沒有殘留的介面文字表", () => {
    for (const bad of ["export const STRINGS = {", '"zh-TW": { loading: "…" }', "en: { loading: '…' }", "const t: UiStrings = x;"]) {
      expect(TABLE.some((re) => re.test(bad)), bad).toBe(true);
    }
    const found = sources.filter(([p, text]) => !TABLE_OK.has(p) && TABLE.some((re) => re.test(stripComments(text)))).map(([p]) => p);
    expect(found).toEqual([]);
  });
});
