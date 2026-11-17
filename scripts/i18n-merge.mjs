// 翻譯檔的退回規則（#406）：clients/<名稱>/i18n/<語言>.json 只寫與參考情境不同的文字，缺少的鍵用 client/i18n/ 的文字。
// build 與 dev（Vite 外掛）、端對端測試（e2e/support/client.ts）與 check:client 共用，規則只寫在這裡
// （docs/client-config.md「翻譯檔」）。參考情境 client/ 本身不合併，全部必填。
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REFERENCE_CLIENT_DIR } from "./client-dir.mjs";

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// 以 reference 為底，逐鍵覆蓋 override 的值；兩邊都是物件的鍵（例如 errors）逐個子鍵合併。
// override 多出來的鍵保留（由 i18n.schema.json 回報）。回傳合併結果與退回的鍵（以 . 連接的路徑）。
export function mergeStrings(reference, override) {
  const fallback = [];
  const merge = (ref, own, prefix) => {
    if (!isObject(own) || !isObject(ref)) return own;
    const out = {};
    for (const [key, value] of Object.entries(ref)) {
      const path = `${prefix}${key}`;
      if (Object.hasOwn(own, key)) out[key] = merge(value, own[key], `${path}.`);
      else {
        out[key] = value;
        fallback.push(...(isObject(value) ? leaves(value, `${path}.`) : [path]));
      }
    }
    for (const [key, value] of Object.entries(own)) if (!Object.hasOwn(ref, key)) out[key] = value;
    return out;
  };
  return { strings: merge(reference, override, ""), fallback };
}

const leaves = (value, prefix) =>
  Object.entries(value).flatMap(([k, v]) => (isObject(v) ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

// 退回哪一個語言：參考情境有同語言時用同語言，否則用參考情境的預設語言
export function fallbackLanguage(language, referenceLanguages, referenceDefault) {
  return referenceLanguages.includes(language) ? language : referenceDefault;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const same = (a, b) => resolve(a) === resolve(b);

// 參考情境的語言與翻譯檔（client.json 的 languages、defaultLanguage 與 i18n/<語言>.json）
export function readReference(referenceDir = REFERENCE_CLIENT_DIR) {
  const { languages, defaultLanguage } = readJson(join(referenceDir, "client.json"));
  const i18n = {};
  for (const language of languages) {
    const path = join(referenceDir, "i18n", `${language}.json`);
    if (existsSync(path)) i18n[language] = readJson(path);
  }
  return { dir: referenceDir, languages, defaultLanguage, i18n };
}

// 客戶資料夾的某個語言合併後的介面文字；clientDir 是參考情境時原樣回傳。
// source 是退回的語言，fallback 是退回的鍵
export function mergedStrings(clientDir, language, reference = readReference()) {
  const own = readJson(join(clientDir, "i18n", `${language}.json`));
  if (same(clientDir, reference.dir)) return { strings: own, source: language, fallback: [] };
  const source = fallbackLanguage(language, reference.languages, reference.defaultLanguage);
  const { strings, fallback } = mergeStrings(reference.i18n[source], own);
  return { strings, source, fallback };
}

// Vite 外掛：@client/i18n/<語言>.json 載入時換成合併後的 JSON（build 與 dev server 相同）。
// 選定的是參考情境時不做事；app/src/client/i18n.ts 的 import.meta.glob 不變
export function i18nMergePlugin(clientDir, referenceDir = REFERENCE_CLIENT_DIR) {
  const i18nDir = resolve(clientDir, "i18n");
  return {
    name: "kk-i18n-merge",
    enforce: "pre",
    load(id) {
      if (same(clientDir, referenceDir)) return null;
      const path = id.split("?")[0];
      if (!path.endsWith(".json") || !same(join(path, ".."), i18nDir)) return null;
      const language = path.slice(path.lastIndexOf("/") + 1, -".json".length);
      const reference = readReference(referenceDir);
      const source = fallbackLanguage(language, reference.languages, reference.defaultLanguage);
      // 參考情境的翻譯檔改了也重新載入（dev server）
      this.addWatchFile?.(join(referenceDir, "i18n", `${source}.json`));
      return JSON.stringify(mergedStrings(clientDir, language, reference).strings);
    },
  };
}
