// 文字類別的規則（#83）：語言或文字類別的規則只放在 app/src/language/（structure.test.ts 檢查）。
// 依字元的文字類別套用，不依語言代碼：問題沒有可靠的語言標籤，段落也常中英混排。
// 新增語言見 docs/retrieval.md「新增語言」。

// 切詞方式：
// - bigram：相鄰兩字一組（不以空白分詞的文字，例如漢字）
// - word：以空白與標點切出單字
// - segmenter：交給 Intl.Segmenter 斷詞，每個詞再以 word 處理（目前沒有類別使用）
export type TokenMode = "bigram" | "word" | "segmenter";

export interface ScriptRule {
  // 正規表示式字元類別的內容（不含方括號）
  chars: string;
  mode: TokenMode;
  // 套用哪個語言的停用詞（stopwords.ts 的鍵）；bigram 依單字比對
  stopwords?: string;
  // 字尾的處理（word 與 segmenter）
  stem?: (word: string) => string;
  // 換行與句子相連時不加空白
  joinsWithoutSpace: boolean;
  // segmenter 用的語言代碼
  locale?: string;
}

// 英文的字尾複數 s：短字與 ss 結尾不去
const stripPluralS = (word: string) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);

// 依序比對；一段文字只屬於第一個符合的類別
export const SCRIPTS: readonly ScriptRule[] = [
  { chars: "\\p{Script=Han}", mode: "bigram", stopwords: "zh", joinsWithoutSpace: true },
  // 日文的片假名（外來語，連同長音符號 ー）以整個詞為關鍵字；平假名多為助詞與語尾，以 bigram 處理並去掉日文停用字
  { chars: "\\p{Script=Katakana}\\u30fc", mode: "word", joinsWithoutSpace: true },
  { chars: "\\p{Script=Hiragana}", mode: "bigram", stopwords: "ja", joinsWithoutSpace: true },
];

// 其他文字與數字（拉丁字母等）
export const OTHER: ScriptRule = { chars: "\\p{L}\\p{N}", mode: "word", stopwords: "en", stem: stripPluralS, joinsWithoutSpace: false };

// 全形標點與 CJK 符號（，。！？、：等）：與 joinsWithoutSpace 的類別一樣，相連時不加空白
export const FULLWIDTH_PUNCTUATION = "\\u3000-\\u303f\\uff00-\\uffef";

// 句尾：全形句尾之後直接斷開；半形句尾之後接空白才斷開
export const SENTENCE_ENDS = { fullwidth: "。！？", halfwidth: ".!?" };
