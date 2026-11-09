// 預設問題的檢索案例（scenarios.target.test.ts 使用，#175）：每題以每種語言各一個案例，只要求與問題同語言的答案段落。
// 用哪個檢索實作、套用哪條涵蓋規則由測試決定；這裡不讀客戶選用的實作（只有 providers.ts 選擇實作，providers.test.ts 檢查）。
import type { ScenariosFile } from "../client/types";

export interface ScenarioCase {
  // 預設問題的 id
  question: string;
  role: string;
  language: string;
  // 該語言沒有問題文字時為 undefined
  text: string | undefined;
  // 與問題同語言的答案段落
  expected: string[];
}

// passageLanguage：段落 id → 段落的語言
export function scenarioCases(scenarios: ScenariosFile, languages: readonly string[], passageLanguage: ReadonlyMap<string, string>): ScenarioCase[] {
  return scenarios.scenarios.flatMap((s) =>
    s.questions.flatMap((q) =>
      languages.map((language) => ({
        question: q.id,
        role: s.role,
        language,
        text: q.text[language],
        expected: q.answerPassages.filter((id) => passageLanguage.get(id) === language),
      })),
    ),
  );
}

export interface Uncovered {
  // 不符合規則的案例
  cases: ScenarioCase[];
  // 沒有任何一種語言有同語言答案段落的題目 id（只在不要求每種語言時列出）
  questions: string[];
}

// 涵蓋規則：每種語言都要有問題文字；sameLanguageEverywhere 時每種語言都要有同語言答案段落（keyword-hash 不能跨語言，#22 決定 2），
// 否則至少一種語言有（語意向量的客戶，事實可能只寫在一種語言；跨語言的部分由人在瀏覽器確認，#175）
export function uncoveredCases(cases: readonly ScenarioCase[], sameLanguageEverywhere: boolean): Uncovered {
  if (sameLanguageEverywhere) return { cases: cases.filter((c) => c.text === undefined || c.expected.length === 0), questions: [] };
  const questions = [...new Set(cases.map((c) => c.question))];
  return {
    cases: cases.filter((c) => c.text === undefined),
    questions: questions.filter((q) => cases.every((c) => c.question !== q || c.expected.length === 0)),
  };
}
