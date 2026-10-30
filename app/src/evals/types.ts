// client/evals/ 的型別。JSON Schema（client/schema/evals/）是唯一正本；改 Schema 時同步修改本檔與 keys.ts。
import type { Id, LanguageCode } from "../client/types";

export type EvalCategory = "scenario" | "permission" | "out-of-scope" | "conflict" | "extraction-attempt";
export type EvalExpect = "answer" | "refusal";

// 一組同義說法，命中其中一個就算命中這一項
export type Synonyms = string[];

export interface EvalQuestion {
  id: Id;
  // 以此身分經 withIdentity() 執行
  role: Id;
  language: LanguageCode;
  category: EvalCategory;
  question: string;
  expect: EvalExpect;
  answerPassages: Id[];
  keyPoints: Synonyms[];
  forbidden: Synonyms[];
  // 模型評分用；refusal 時為 null
  referenceAnswer: string | null;
}

export interface QuestionsFile {
  questions: EvalQuestion[];
}
