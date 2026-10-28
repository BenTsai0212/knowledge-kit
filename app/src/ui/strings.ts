// 介面文字：集中在本檔，元件與問答模組不寫死文字（#26 決定 4）。正式的翻譯檔格式在 Epic 第 11 項，屆時移到 client/。
import type { LanguageCode } from "../client/types";

export interface UiStrings {
  // 拒答：「沒有資料」與「沒有權限」相同，不透露是否有看不到的文件
  refusal: string;
  // 不是拒答、但沒有任何有效引用的回答
  uncited: string;
}

export const STRINGS: Record<LanguageCode, UiStrings> = {
  "zh-TW": {
    refusal: "找不到可以回答這個問題的資料。",
    uncited: "未附出處",
  },
  en: {
    refusal: "I couldn't find information to answer this question.",
    uncited: "No sources cited",
  },
};

export function strings(language: LanguageCode): UiStrings {
  if (!Object.hasOwn(STRINGS, language)) throw new Error(`沒有介面文字的語言：${language}`);
  return STRINGS[language];
}
