import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import type { ScenariosFile } from "../client/types";
import { dataset } from "../dataset/load";
import { scenarioCases, uncoveredCases, type Uncovered } from "./scenario-cases";

// 虛構的三語情境：q1 的答案三種語言都有，q2 只有日文，q3 沒有答案段落，q4 缺英文的問題文字
const LANGUAGES = ["zh-TW", "en", "ja"];
const passageLanguage = new Map([
  ["p-zh", "zh-TW"],
  ["p-en", "en"],
  ["p-ja", "ja"],
]);
const text = { "zh-TW": "問題", en: "Question", ja: "質問" };
const scenarios: ScenariosFile = {
  scenarios: [
    {
      id: "s1",
      title: text,
      role: "staff",
      questions: [
        { id: "q1", text, answerPassages: ["p-zh", "p-en", "p-ja"] },
        { id: "q2", text, answerPassages: ["p-ja"] },
        { id: "q3", text, answerPassages: [] },
        { id: "q4", text: { "zh-TW": "問題", ja: "質問" }, answerPassages: ["p-zh"] },
      ],
    },
  ],
};
const cases = scenarioCases(scenarios, LANGUAGES, passageLanguage);
const names = ({ cases, questions }: Uncovered) => [...cases.map((c) => `${c.question}（${c.language}）`), ...questions];

describe("scenarioCases", () => {
  it("每題每種語言一個案例，只列同語言的答案段落", () => {
    expect(cases).toHaveLength(4 * LANGUAGES.length);
    expect(cases.filter((c) => c.question === "q2").map((c) => [c.language, c.expected])).toEqual([
      ["zh-TW", []],
      ["en", []],
      ["ja", ["p-ja"]],
    ]);
    expect(cases.find((c) => c.question === "q4" && c.language === "en")).toMatchObject({ role: "staff", text: undefined, expected: [] });
  });
});

describe("uncoveredCases", () => {
  it("每種語言都要有：缺同語言答案段落或問題文字的案例都列出", () => {
    expect(names(uncoveredCases(cases, true))).toEqual(["q2（zh-TW）", "q2（en）", "q3（zh-TW）", "q3（en）", "q3（ja）", "q4（en）", "q4（ja）"]);
  });

  it("至少一種語言有：只列缺問題文字的案例與完全沒有同語言答案段落的題目", () => {
    expect(names(uncoveredCases(cases, false))).toEqual(["q4（en）", "q3"]);
  });

  it("選定的客戶（npm test 是參考情境）兩種規則都通過", () => {
    const passages = new Map(Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => [p.id, p.language ?? d.language] as const)));
    const actual = scenarioCases(clientConfig.scenarios, clientConfig.client.languages, passages);
    expect(names(uncoveredCases(actual, true))).toEqual([]);
    expect(names(uncoveredCases(actual, false))).toEqual([]);
  });
});
