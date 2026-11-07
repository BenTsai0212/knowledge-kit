import { describe, expect, it } from "vitest";
import { cosine, DIMENSIONS, embedText, fnv1a, keywordHashProvider } from "./keyword-hash";

const score = (question: string, passage: string) => cosine(embedText(question), embedText(passage));
const rank = (question: string, passages: string[]) =>
  [...passages].sort((a, b) => score(question, b) - score(question, a));

describe("雜湊向量", () => {
  it("FNV-1a 與參考值相同", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
  });

  it("向量經過 L2 正規化，維度在範圍內", () => {
    const v = embedText("青翼桌預計 2026 年第三季上市");
    expect([...v.values()].reduce((s, x) => s + x * x, 0)).toBeCloseTo(1);
    expect([...v.keys()].every((i) => Number.isInteger(i) && i >= 0 && i < DIMENSIONS)).toBe(true);
  });

  it("相同文字為 1，沒有共同特徵為 0，空字串為 0", () => {
    expect(score("年假天數", "年假天數")).toBeCloseTo(1);
    expect(score("年假", "desk")).toBe(0);
    expect(score("", "年假")).toBe(0);
  });

  it("provider 以批次轉換，結果與逐筆相同；問題與段落的轉法相同", async () => {
    const texts = ["年假", "annual leave"];
    expect(await keywordHashProvider.embed(texts, "query")).toEqual(texts.map(embedText));
    expect(await keywordHashProvider.embed(texts, "passage")).toEqual(texts.map(embedText));
    expect(keywordHashProvider.id).toBe("keyword-hash");
  });
});

describe("計分：中文", () => {
  const passages = ["到職滿一年有 7 天年假。", "人資部的經理是吳宜蓁。", "青翼桌預計第三季上市。"];

  it("共同的雙字詞越多分數越高", () => {
    expect(rank("一年有幾天年假？", passages)[0]).toBe(passages[0]);
    expect(rank("人資部的經理是誰？", passages)[0]).toBe(passages[1]);
    expect(rank("青翼桌什麼時候上市？", passages)[0]).toBe(passages[2]);
  });

  it("沒有共同雙字詞時，單字特徵仍能部分命中", () => {
    expect(score("調薪", "薪資")).toBeGreaterThan(0);
  });
});

describe("計分：英文", () => {
  const passages = [
    "Annual leave is 7 days after one year.",
    "The People team is managed by Yizhen Wu.",
    "The Bluewing desk launched in the third quarter.",
  ];

  it("共同的單字越多分數越高", () => {
    expect(rank("How many days of annual leave?", passages)[0]).toBe(passages[0]);
    expect(rank("Who manages the People team?", passages)[0]).toBe(passages[1]);
    expect(rank("When will the Bluewing desk launch?", passages)[0]).toBe(passages[2]);
  });

  it("字形變化以 3 字元組部分命中", () => {
    expect(score("launch", "launched")).toBeGreaterThan(0);
  });
});

describe("不支援跨語言", () => {
  it("中文問題與只有英文的段落分數為 0", () => {
    expect(score("年假", "Annual leave is 7 days.")).toBe(0);
  });
});
