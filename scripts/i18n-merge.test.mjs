import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REFERENCE_CLIENT_DIR } from "./client-dir.mjs";
import { fallbackLanguage, i18nMergePlugin, mergeStrings, mergedStrings, readReference } from "./i18n-merge.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const reference = (language) => readJson(join(REFERENCE_CLIENT_DIR, "i18n", `${language}.json`));
const leaves = (value, prefix = "") =>
  Object.entries(value).flatMap(([k, v]) => (typeof v === "object" ? leaves(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));

// 參考情境以外的客戶資料夾：只複製 client.json，翻譯檔由各測試寫入
function withClient(i18n, run) {
  const dir = mkdtempSync(join(tmpdir(), "kk-i18n-merge-"));
  try {
    cpSync(join(REFERENCE_CLIENT_DIR, "client.json"), join(dir, "client.json"));
    cpSync(join(REFERENCE_CLIENT_DIR, "i18n"), join(dir, "i18n"), { recursive: true });
    for (const [language, data] of Object.entries(i18n)) writeFileSync(join(dir, "i18n", `${language}.json`), JSON.stringify(data));
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("mergeStrings", () => {
  it("缺少的鍵用參考情境的值，有寫的鍵用客戶的值", () => {
    const { strings, fallback } = mergeStrings({ a: "A", b: "B" }, { b: "客戶的 B" });
    expect(strings).toEqual({ a: "A", b: "客戶的 B" });
    expect(fallback).toEqual(["a"]);
  });

  it("巢狀的鍵逐個子鍵退回", () => {
    const { strings, fallback } = mergeStrings(
      { errors: { daily_limit: "D", global_daily_limit: "G" }, other: { x: "X" } },
      { errors: { global_daily_limit: "客戶的 G" } },
    );
    expect(strings).toEqual({ errors: { daily_limit: "D", global_daily_limit: "客戶的 G" }, other: { x: "X" } });
    expect(fallback).toEqual(["errors.daily_limit", "other.x"]);
  });

  it("多出來的鍵與型別不同的值保留，交給 Schema 回報", () => {
    const { strings } = mergeStrings({ a: "A", errors: { x: "X" } }, { logo: "Logo", errors: "不是物件" });
    expect(strings).toEqual({ a: "A", errors: "不是物件", logo: "Logo" });
  });

  it("空物件 {} 得到參考情境的全部文字", () => {
    const { strings, fallback } = mergeStrings(reference("en"), {});
    expect(strings).toEqual(reference("en"));
    expect(fallback).toHaveLength(leaves(reference("en")).length);
  });
});

describe("fallbackLanguage", () => {
  it("參考情境有同語言時用同語言，沒有時用參考情境的預設語言", () => {
    expect(fallbackLanguage("en", ["zh-TW", "en"], "zh-TW")).toBe("en");
    expect(fallbackLanguage("ja", ["zh-TW", "en"], "zh-TW")).toBe("zh-TW");
  });
});

describe("mergedStrings", () => {
  it("參考情境 client/ 原樣讀取，不合併", () => {
    expect(mergedStrings(REFERENCE_CLIENT_DIR, "en")).toEqual({ strings: reference("en"), source: "en", fallback: [] });
  });

  it("客戶缺少的鍵退回同語言；client/ 沒有的語言退回預設語言", () => {
    withClient({ en: { loading: "Hold on" }, ja: { loading: "読み込み中" } }, (dir) => {
      const en = mergedStrings(dir, "en");
      expect(en.strings).toEqual({ ...reference("en"), loading: "Hold on" });
      expect(en.source).toBe("en");
      const ja = mergedStrings(dir, "ja");
      expect(ja.strings).toEqual({ ...reference("zh-TW"), loading: "読み込み中" });
      expect(ja.source).toBe("zh-TW");
      expect(ja.fallback).not.toContain("loading");
    });
  });
});

describe("i18nMergePlugin", () => {
  const load = (plugin, id) => plugin.load.call({ addWatchFile() {} }, id);

  it("客戶的 i18n/<語言>.json 換成合併後的 JSON：鍵與參考情境相同、沒有空白的值", () => {
    withClient({ en: {} }, (dir) => {
      const out = JSON.parse(load(i18nMergePlugin(dir), join(dir, "i18n", "en.json")));
      const keys = (data) => leaves(data).map(([k]) => k).sort();
      expect(keys(out)).toEqual(keys(reference("en")));
      expect(leaves(out).every(([, v]) => typeof v === "string" && v.trim() !== "")).toBe(true);
    });
  });

  it("參考情境、i18n/ 以外的檔案不處理", () => {
    expect(load(i18nMergePlugin(REFERENCE_CLIENT_DIR), join(REFERENCE_CLIENT_DIR, "i18n", "en.json"))).toBeNull();
    withClient({}, (dir) => {
      expect(load(i18nMergePlugin(dir), join(dir, "client.json"))).toBeNull();
      expect(load(i18nMergePlugin(dir), join(dir, "i18n", "en.json?import"))).toEqual(expect.any(String));
    });
  });

  it("兩個示範客戶合併後的翻譯檔，鍵都與參考情境相同", () => {
    const keys = (data) => leaves(data).map(([k]) => k).sort();
    for (const name of ["kestrova-demo", "medsupply-demo"]) {
      const dir = fileURLToPath(new URL(`../clients/${name}/`, import.meta.url));
      for (const language of readJson(join(dir, "client.json")).languages) {
        const source = fallbackLanguage(language, readReference().languages, readReference().defaultLanguage);
        expect(keys(mergedStrings(dir, language).strings), `${name} ${language}`).toEqual(keys(reference(source)));
      }
    }
  });
});
