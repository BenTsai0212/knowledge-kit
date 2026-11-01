// 介面文字的唯一讀取模組：選定客戶的 i18n/<語言>.json（@client 別名） 在 build 時讀入，新增語言只要加一份檔案（docs/client-config.md「翻譯檔」）。
// 鍵與參數由 npm run check:client 檢查（i18n.schema.json 與 scripts/check-client.mjs），執行時不驗證。
import type { AskErrorType, ExtractFailure, LanguageCode, UiStrings } from "./types";

const files = import.meta.glob<UiStrings>("@client/i18n/*.json", { eager: true, import: "default" });

// 檔名（不含 .json）→ 介面文字
export const TRANSLATIONS: Readonly<Record<LanguageCode, UiStrings>> = Object.fromEntries(
  Object.entries(files).map(([path, s]) => [path.slice(path.lastIndexOf("/") + 1, -".json".length), s]),
);

export function strings(language: LanguageCode): UiStrings {
  if (!Object.hasOwn(TRANSLATIONS, language)) throw new Error(`No UI strings for language: ${language}`);
  return TRANSLATIONS[language];
}

// 範本中的 {key} 換成值，一次掃過，值中的 {…} 與 $& 不再解讀（名稱、標題以文字顯示）；沒有給值的參數保留原樣
export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => (Object.hasOwn(values, key) ? String(values[key]) : match));

// 錯誤類型 → 使用者看得懂的訊息；不認得的類型用通用訊息
export function errorMessage(language: LanguageCode, error: string): string {
  const s = strings(language);
  return Object.hasOwn(s.errors, error) ? s.errors[error as AskErrorType] : s.unknownError;
}

// 萃取與比對的失敗原因 → 訊息：自己的原因（ExtractFailure）用 extractErrors，其他是 /api/ask 的錯誤類型
export function taskErrorMessage(language: LanguageCode, error: string): string {
  const s = strings(language);
  return Object.hasOwn(s.extractErrors, error) ? s.extractErrors[error as ExtractFailure] : errorMessage(language, error);
}
