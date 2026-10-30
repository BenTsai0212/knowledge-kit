// 評測題庫各物件型別的鍵清單，供 app/src/client/schema-sync.test.ts 與 JSON Schema 比對（作法見 app/src/client/keys.ts）。
import type { KeyManifest, ManifestEntry } from "../client/keys";
import type { EvalQuestion, QuestionsFile } from "./types";

export const evalsManifests: ManifestEntry[] = [
  {
    schema: "evals/questions.schema.json",
    pointer: "",
    keys: { questions: "required" } satisfies KeyManifest<QuestionsFile>,
  },
  {
    schema: "evals/questions.schema.json",
    pointer: "/properties/questions/items",
    keys: {
      id: "required",
      role: "required",
      language: "required",
      category: "required",
      question: "required",
      expect: "required",
      answerPassages: "required",
      keyPoints: "required",
      forbidden: "required",
      referenceAnswer: "required",
    } satisfies KeyManifest<EvalQuestion>,
  },
];
