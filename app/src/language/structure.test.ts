// 結構測試（#83 決定 4）：語言或文字類別的規則只能放在語言模組 app/src/language/，
// 新增語言時只需修改 client/（或 clients/<名稱>/）、翻譯檔與語言模組。
// 掃描 app/src/ 與 worker/ 去掉註解後的原始碼（不含測試：測試會以文字類別檢查資料，例如 dataset.test.ts）。
import { describe, expect, it } from "vitest";
import { sources as appSources, stripComments } from "../client/source-scan";

const workerSources = Object.entries(
  import.meta.glob<string>(["../../../worker/**/*.ts", "!../../../worker/**/*.test.ts"], { query: "?raw", import: "default", eager: true }),
);
const sources = [...appSources, ...workerSources];
const LANGUAGE_MODULE = "../language/";

const RULES: [string, RegExp][] = [
  ["文字類別的 Unicode 屬性", /\\p\{(?:Script|sc|Script_Extensions|scx)=|\\p\{(?:Ideographic|Ideo)\}/],
  // 假名、漢字、諺文、全形字元與 CJK 符號的範圍：3000–D7AF、F900–FAFF、FF00–FFEF
  ["CJK 範圍的 \\u 跳脫", /\\u\{?0*(?:[3-9a-c][0-9a-f]{3}|d[0-7][0-9a-f]{2}|f[9a][0-9a-f]{2}|ff[0-9a-e][0-9a-f])\b/i],
  // 只看正規表示式字面值中的字元類別（陣列中的中文字串不算）
  ["含 CJK 字元的正規表示式字元類別", /\/[^/\n]*\[[^\]\n]*[　-鿿가-힯＀-￯][^\]\n]*\][^/\n]*\//],
  ["半形句尾的字元類別", /\[(?=[^\]\n]*\.)(?=[^\]\n]*!)(?=[^\]\n]*\?)[^\]\n]*\]/],
  ["停用詞表", /\b(?:\w+_STOP|\w*STOP_?WORDS?|\w*[sS]top[wW]ords?)\s*[:=]/],
];

const violations = (text: string) => RULES.filter(([, re]) => re.test(stripComments(text))).map(([name]) => name);

describe("語言規則只在語言模組", () => {
  it("規則抓得到各種寫法（反向驗證）", () => {
    for (const bad of [
      "const HAN = /\\p{Script=Han}/u;",
      "const KANA = /[\\p{sc=Hira}\\p{scx=Kana}]/u;",
      "const IDEO = /\\p{Ideographic}/u;",
      "const CJK = /[\\u3000-\\u303f]/;",
      "const KATAKANA = /[\\u{30A0}-\\u{30FF}]/u;",
      "const HANGUL = /[\\uAC00-\\uD7AF]/;",
      "text.split(/(?<=[。！？])/);",
      "const KANA_RANGE = /[ぁ-ゖ]/;",
      "text.split(/(?<=[.!?])\\s+/);",
      "const END = /[?!.]$/;",
      'const EN_STOP = new Set("a an the".split(" "));',
      "const STOPWORDS = { en: new Set() };",
      "const jaStopwords = new Set();",
      "export const STOP_WORDS: string[] = [];",
    ]) {
      expect(violations(bad), bad).not.toEqual([]);
    }
  });

  it("不誤判與語言無關的寫法", () => {
    for (const ok of [
      "export const STOP_ERRORS = new Set(['budget']);",
      "const WORD = /[\\p{L}\\p{N}]+/gu;",
      'const NBSP = "\\u00a0";',
      'const BOM = "\\ufeff";',
      "text.split(/[,;]/);",
      "const URL = /[a-z.]+/;",
      "if (stopped) return;",
      'const messages = [{ role: "user", content: "你好" }];',
      "// const HAN = /\\p{Script=Han}/u;",
    ]) {
      expect(violations(ok), ok).toEqual([]);
    }
  });

  it("掃描範圍包含 app/src/、worker/ 與語言模組，不含測試", () => {
    const paths = sources.map(([p]) => p);
    expect(paths).toEqual(expect.arrayContaining(["../retrieval/tokenize.ts", "../upload/chunk.ts", "../../../worker/src/ask.ts"]));
    expect(paths.filter((p) => p.endsWith(".test.ts"))).toEqual([]);
    // 語言模組確實含有這些規則，例外有必要
    const inModule = sources.filter(([p]) => p.startsWith(LANGUAGE_MODULE)).flatMap(([, text]) => violations(text));
    expect(inModule).toEqual(expect.arrayContaining(["文字類別的 Unicode 屬性", "CJK 範圍的 \\u 跳脫", "停用詞表"]));
  });

  it("語言模組以外沒有文字類別、句尾標點與停用詞表", () => {
    const found = sources
      .filter(([p]) => !p.startsWith(LANGUAGE_MODULE))
      .flatMap(([p, text]) => violations(text).map((name) => `${p}：${name}`));
    expect(found).toEqual([]);
  });
});
