// 在 build 時讀入選定客戶的 evals/（@client 別名）。Schema 由 npm run check:client（ajv）在 CI 檢查；需要資料集的規則由 validate.ts 檢查。
import questions from "@client/evals/questions.json";
import type { Widen } from "../client/load";
import type { QuestionsFile } from "./types";

// JSON import 的路徑必須是 @client/ 開頭的字面值，所以 app 只支援 client.json 的 evals.path 為 evals/
export const EVALS_ROOT = "evals/";

// 形狀不符時 typecheck 失敗；列舉值由 ajv 檢查
const checked: Widen<QuestionsFile> = questions;

export const evalQuestions: QuestionsFile = checked as QuestionsFile;
