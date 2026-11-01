// 各語言的停用詞（#83 決定 2：放在語言模組，不放 client/）；由 scripts.ts 的 stopwords 指定套用在哪個文字類別。
// - en：以 word 切出的整個單字
// - zh、ja：單字（bigram 中兩字都是停用字的組合不計，單字特徵也不計）；ja 是平假名的助詞與語尾

export const STOPWORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(
    "a an the is are was were be been of to in on for and or what who whom which when where how do does did i my me you your we our it its this that after with by at from will have has many much".split(
      " ",
    ),
  ),
  zh: new Set([..."的是誰有哪些什麼麼嗎呢了在和與及我你他她它們這那幾多少如何目前"]),
  ja: new Set([..."のはがをにでともへやかなねよだすましてたいるれらうん"]),
};
