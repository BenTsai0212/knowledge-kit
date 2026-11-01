// 語言模組的單元測試；切詞與切段的整體行為另見 retrieval/tokenize.test.ts、upload/chunk.test.ts
import { describe, expect, it } from "vitest";
import { OTHER, type ScriptRule } from "./scripts";
import { joinLine, joinSentence, segments, splitSentences } from "./text";

const brief = (text: string, scripts?: readonly ScriptRule[]) => segments(text, scripts).map((s) => [s.text, s.mode]);

describe("segments：依文字類別切段", () => {
  it("漢字為 bigram，其他文字與數字為 word；標點與空白去掉", () => {
    expect(brief("Bluewing 青翼桌，Q3上市！")).toEqual([
      ["Bluewing", "word"],
      ["青翼桌", "bigram"],
      ["Q3", "word"],
      ["上市", "bigram"],
    ]);
  });

  it("停用詞與字尾處理依所屬類別", () => {
    const [en, zh] = segments("the 的");
    expect([en.isStopword("the"), en.isStopword("的"), zh.isStopword("的"), zh.isStopword("the")]).toEqual([true, false, true, false]);
    expect([en.stem("desks"), en.stem("class"), en.stem("bus"), zh.stem("專案")]).toEqual(["desk", "class", "bus", "專案"]);
  });

  it("日文：漢字為 bigram，片假名（含長音符號）為 word，平假名為 bigram 並套用日文停用字", () => {
    expect(brief("人事部のマネージャーは誰ですか？")).toEqual([
      ["人事部", "bigram"],
      ["の", "bigram"],
      ["マネージャー", "word"],
      ["は", "bigram"],
      ["誰", "bigram"],
      ["ですか", "bigram"],
    ]);
    const [, hiragana, katakana] = segments("部のマ");
    expect([hiragana.isStopword("の"), hiragana.isStopword("つ"), katakana.isStopword("の")]).toEqual([true, false, false]);
  });

  it("文字類別可指定 segmenter：以 Intl.Segmenter 切成 word", () => {
    const kana: ScriptRule = { chars: "\\p{Script=Hiragana}\\p{Script=Katakana}", mode: "segmenter", locale: "ja", joinsWithoutSpace: true };
    const out = brief("テスト desk", [kana]);
    expect(out.at(-1)).toEqual(["desk", "word"]);
    expect(out.slice(0, -1).every(([, mode]) => mode === "word")).toBe(true);
    expect(out.slice(0, -1).map(([t]) => t).join("")).toBe("テスト");
    // 沒有指定的類別仍用 OTHER
    expect(brief("青翼", [kana])).toEqual([["青翼", "word"]]);
    expect(OTHER.mode).toBe("word");
  });
});

// CI（Node 22）與 Chrome 都要支援 Intl.Segmenter 的日文與泰文（#83 計畫第 3 節）；目前沒有類別使用 segmenter
describe("Intl.Segmenter", () => {
  it("支援日文與泰文的斷詞", () => {
    expect(Intl.Segmenter.supportedLocalesOf(["ja", "th"])).toEqual(["ja", "th"]);
    const words = (locale: string, text: string) =>
      [...new Intl.Segmenter(locale, { granularity: "word" }).segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);
    expect(words("ja", "テストです").length).toBeGreaterThan(1);
    expect(words("th", "วันเปิดตัว").length).toBeGreaterThan(1);
  });
});

describe("相連與句尾", () => {
  it("換行：兩側都是漢字或全形標點時直接相連，否則加空白", () => {
    expect(joinLine("", "第一行")).toBe("第一行");
    expect(joinLine("公告，", "說明")).toBe("公告，說明");
    expect(joinLine("公告", "Desk")).toBe("公告 Desk");
    expect(joinLine("The", "desk")).toBe("The desk");
  });

  it("換行：假名與漢字、全形標點之間直接相連", () => {
    expect(joinLine("サンプル社は", "家具メーカーです")).toBe("サンプル社は家具メーカーです");
    expect(joinLine("テスト", "Desk")).toBe("テスト Desk");
    expect(joinSentence("完成しました。", "次は")).toBe("完成しました。次は");
    expect(splitSentences("完成しました。次は移行です！")).toEqual(["完成しました。", "次は移行です！"]);
  });

  it("句子：前一句以漢字或全形標點結尾時直接相連", () => {
    expect(joinSentence("第一句。", "Next.")).toBe("第一句。Next.");
    expect(joinSentence("First.", "第二句。")).toBe("First. 第二句。");
  });

  it("全形句尾直接斷開，半形句尾後接空白才斷開", () => {
    expect(splitSentences("第一句。第二句！第三句？")).toEqual(["第一句。", "第二句！", "第三句？"]);
    expect(splitSentences("One. Two! Three? v1.2")).toEqual(["One.", "Two!", "Three?", "v1.2"]);
  });
});
