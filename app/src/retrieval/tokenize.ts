// keyword-hash 的切詞：依字元的文字類別切段（語言模組 app/src/language/），不依語言標籤，所以中英混排也能處理。
// bigram（例如漢字）：關鍵字為相鄰兩字一組，字元特徵為單字。
// word（其他文字與數字）：關鍵字為單字（去掉停用詞，並做字尾處理），字元特徵為前後補 ^、$ 後的 3 字元組。
import { segments } from "../language/text";

export interface Features {
  keywords: string[];
  chars: string[];
}

export function tokenize(text: string): Features {
  const keywords: string[] = [];
  const chars: string[] = [];
  for (const { text: segment, mode, isStopword, stem } of segments(text.normalize("NFKC").toLowerCase())) {
    if (mode === "bigram") {
      const units = [...segment];
      for (let i = 0; i + 1 < units.length; i++) {
        if (!(isStopword(units[i]) && isStopword(units[i + 1]))) keywords.push(units[i] + units[i + 1]);
      }
      chars.push(...units.filter((c) => !isStopword(c)));
    } else if (!isStopword(segment)) {
      const word = stem(segment);
      keywords.push(word);
      const padded = [...`^${word}$`];
      for (let i = 0; i + 3 <= padded.length; i++) chars.push(padded.slice(i, i + 3).join(""));
    }
  }
  return { keywords, chars };
}
