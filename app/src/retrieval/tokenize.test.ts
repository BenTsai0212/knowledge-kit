import { describe, expect, it } from "vitest";
import { tokenize } from "./tokenize";

describe("tokenize：中文", () => {
  it("相鄰兩字一組為關鍵字，單字為字元特徵", () => {
    expect(tokenize("青翼專案")).toEqual({ keywords: ["青翼", "翼專", "專案"], chars: ["青", "翼", "專", "案"] });
  });

  it("兩字都是停用字的組合不計，單字特徵不計停用字", () => {
    // 「的是」「是誰」兩字都是停用字
    expect(tokenize("負責人的是誰")).toEqual({
      keywords: ["負責", "責人", "人的"],
      chars: ["負", "責", "人"],
    });
  });

  it("標點與空白切開段落，不跨段組字", () => {
    expect(tokenize("年假，天數").keywords).toEqual(["年假", "天數"]);
  });

  it("單一個字只有字元特徵", () => {
    expect(tokenize("薪")).toEqual({ keywords: [], chars: ["薪"] });
  });
});

describe("tokenize：英文", () => {
  it("轉小寫、去掉停用詞與字尾複數 s", () => {
    expect(tokenize("What are the Departments?").keywords).toEqual(["department"]);
  });

  it("短字與 ss 結尾不去 s", () => {
    expect(tokenize("bus class").keywords).toEqual(["bus", "class"]);
  });

  it("字元特徵為前後補邊界符號的 3 字元組", () => {
    expect(tokenize("desk").chars).toEqual(["^de", "des", "esk", "sk$"]);
  });

  it("數字視為一個詞", () => {
    expect(tokenize("in 2026").keywords).toEqual(["2026"]);
  });
});

describe("tokenize：日文", () => {
  it("片假名以整個詞為關鍵字，平假名的助詞與語尾不計", () => {
    expect(tokenize("人事部のマネージャーは誰ですか？").keywords).toEqual(["人事", "事部", "マネージャー"]);
  });

  it("平假名中不全是停用字的組合仍計入", () => {
    expect(tokenize("いつ").keywords).toEqual(["いつ"]);
  });

  it("半形片假名以 NFKC 轉成全形", () => {
    expect(tokenize("ﾏﾈｰｼﾞｬｰ")).toEqual(tokenize("マネージャー"));
  });
});

describe("tokenize：混排與正規化", () => {
  it("中英混排時各自切詞", () => {
    expect(tokenize("Bluewing 青翼桌").keywords).toEqual(["bluewing", "青翼", "翼桌"]);
    expect(tokenize("Q3上市").keywords).toEqual(["q3", "上市"]);
  });

  it("全形英數以 NFKC 轉成半形", () => {
    expect(tokenize("ＤＥＳＫ　２０２６")).toEqual(tokenize("desk 2026"));
  });

  it("空字串與只有標點時沒有特徵", () => {
    expect(tokenize("")).toEqual({ keywords: [], chars: [] });
    expect(tokenize("？！…")).toEqual({ keywords: [], chars: [] });
  });
});
