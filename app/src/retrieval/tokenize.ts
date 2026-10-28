// keyword-hash 的切詞：依字元的文字類別切段，不依語言標籤，所以中英混排也能處理。
// 漢字（沒有空格）：關鍵字為相鄰兩字一組，字元特徵為單字。
// 其他文字與數字：關鍵字為單字（去掉停用詞與字尾複數 s），字元特徵為前後補 ^、$ 後的 3 字元組。

export interface Features {
  keywords: string[];
  chars: string[];
}

const HAN = /\p{Script=Han}/u;
const SEGMENT = /\p{Script=Han}+|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu;

const EN_STOP = new Set(
  "a an the is are was were be been of to in on for and or what who whom which when where how do does did i my me you your we our it its this that after with by at from will have has many much".split(
    " ",
  ),
);
const ZH_STOP = new Set([..."的是誰有哪些什麼麼嗎呢了在和與及我你他她它們這那幾多少如何目前"]);

export function tokenize(text: string): Features {
  const keywords: string[] = [];
  const chars: string[] = [];
  for (const [segment] of text.normalize("NFKC").toLowerCase().matchAll(SEGMENT)) {
    if (HAN.test(segment)) {
      const han = [...segment];
      for (let i = 0; i + 1 < han.length; i++) {
        if (!(ZH_STOP.has(han[i]) && ZH_STOP.has(han[i + 1]))) keywords.push(han[i] + han[i + 1]);
      }
      chars.push(...han.filter((c) => !ZH_STOP.has(c)));
    } else if (!EN_STOP.has(segment)) {
      const word = segment.length > 3 && segment.endsWith("s") && !segment.endsWith("ss") ? segment.slice(0, -1) : segment;
      keywords.push(word);
      const padded = [...`^${word}$`];
      for (let i = 0; i + 3 <= padded.length; i++) chars.push(padded.slice(i, i + 3).join(""));
    }
  }
  return { keywords, chars };
}
