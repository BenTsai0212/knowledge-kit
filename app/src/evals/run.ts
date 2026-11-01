// 評測的執行（docs/evals.md「執行」）：以題庫的每一題、題庫指定的角色經 ask() 執行（與一般問答相同），記下檢索結果與送出的 body，評分。
// 一題一題依序執行，不並行；兩組設定時先跑完設定 A 再跑設定 B。資料庫是評測專用的記憶體資料庫（#62 決定 C，openEvalDatabase()）。
import type { ClientConfig, RetrievalConfig } from "../client/types";
import type { Dataset } from "../dataset/load";
import { seedDataset } from "../dataset/seed";
import { openDatabase, type Database } from "../db/database";
import { ask, type Answer } from "../qa/answer";
import { buildPrompt, MAX_QUESTION_CHARS } from "../qa/prompt";
import type { AskBody, AskTransport } from "../qa/types";
import type { Retriever } from "../retrieval/retrieve";
import { gradeAnswer } from "./grade";
import { leakContext, scoreQuestion, type AnswerMode, type LeakContext, type ModelGrade, type QuestionScore } from "./score";
import type { EvalQuestion } from "./types";

// 一組檢索設定；只在這次評測有效，不寫回 client.json
export type EvalSettings = Pick<RetrievalConfig, "topK" | "minScore">;

// 遇到時停止整次評測（之後的題目也一定失敗），保留已完成的結果；其他錯誤記在該題，接著跑下一題
export const STOP_ERRORS: ReadonlySet<string> = new Set([
  "invalid_access_code",
  "forbidden_origin",
  "daily_limit",
  "limit_unavailable",
  "misconfigured",
  "upstream_quota",
  "network",
]);

export interface EvalContext {
  // 評測專用資料庫上的 Retriever；每題依設定帶入 topK、minScore
  retriever: Retriever;
  transport: AskTransport;
  config: Pick<ClientConfig, "client" | "access">;
  data: Dataset;
  questions: EvalQuestion[];
}

export interface QuestionResult {
  question: string;
  answer: Answer;
  score: QuestionScore;
  // 模型評分時才有：expect: "answer" 且結果是回答的題目；拒答或錯誤不另外呼叫
  grade?: ModelGrade;
  // 模型評分的 /api/ask 錯誤類型或 truncated
  gradeError?: string;
}

export interface SetRun {
  settings: EvalSettings;
  // 已完成的題目，依題庫順序
  results: QuestionResult[];
}

export interface EvalRun {
  mode: AnswerMode;
  sets: SetRun[];
  status: "running" | "done" | "stopped";
  // stopped 時：aborted（按停止），或 STOP_ERRORS 中的錯誤類型
  stopReason?: string;
  startedAt: string;
  finishedAt?: string;
}

// 評測專用的記憶體資料庫：只有資料集，不含上傳的文件、待審的處理結果與「說法不同」的決定。
// 呼叫端在評測結束、停止或離開頁籤時 close()
export function openEvalDatabase(config: ClientConfig, data: Dataset): Promise<Database> {
  return openDatabase(config, { seed: (pg) => seedDataset(pg, config, data) });
}

// 帶入這組設定的 topK、minScore，並記下回傳的段落 id
function settingsRetriever(inner: Retriever, settings: EvalSettings, retrieved?: string[]): Retriever {
  return {
    async retrieve(identityId, question, options) {
      const out = await inner.retrieve(identityId, question, { ...options, ...settings });
      retrieved?.push(...out.map((p) => p.id));
      return out;
    },
  };
}

// 這一題會不會呼叫 /api/ask：與 ask() 相同，檢索不到段落或 prompt 放不下時在本機拒答
async function willAsk(ctx: EvalContext, settings: EvalSettings, q: EvalQuestion): Promise<boolean> {
  const text = q.question.trim();
  if (text === "" || text.length > MAX_QUESTION_CHARS) return false;
  const passages = await settingsRetriever(ctx.retriever, settings).retrieve(q.role, text);
  return passages.length > 0 && buildPrompt(passages, text, { companyName: ctx.config.client.displayName[q.language], language: q.language }) !== null;
}

// 預計的呼叫次數：每組設定先跑一次檢索算出實際會送出的問答次數；模型評分以上限計算（會送出的回答題各一次）
export async function estimateCalls(ctx: EvalContext, sets: EvalSettings[], mode: AnswerMode): Promise<{ ask: number; grade: number; total: number }> {
  let askCalls = 0;
  let gradeCalls = 0;
  for (const settings of sets) {
    for (const q of ctx.questions) {
      if (!(await willAsk(ctx, settings, q))) continue;
      askCalls++;
      if (mode === "model" && q.expect === "answer") gradeCalls++;
    }
  }
  return { ask: askCalls, grade: gradeCalls, total: askCalls + gradeCalls };
}

const answerError = (answer: Answer) => (answer.kind === "refusal" ? undefined : answer.error);

// 依序執行；每完成一題、停止或結束都呼叫 onChange（傳入新的物件）。signal 中止時進行中的題目不記錄
export async function runEvals(
  ctx: EvalContext,
  plan: { sets: EvalSettings[]; mode: AnswerMode },
  onChange: (run: EvalRun) => void = () => {},
  signal?: AbortSignal,
): Promise<EvalRun> {
  let run: EvalRun = { mode: plan.mode, sets: plan.sets.map((settings) => ({ settings, results: [] })), status: "running", startedAt: new Date().toISOString() };
  const update = (patch: Partial<EvalRun>) => {
    run = { ...run, ...patch };
    onChange(run);
    return run;
  };
  const stop = (stopReason: string) => update({ status: "stopped", stopReason, finishedAt: new Date().toISOString() });
  const contexts = new Map<string, LeakContext>();
  const leaks = (role: string) => contexts.get(role) ?? contexts.set(role, leakContext(ctx.config.access, ctx.data, role)).get(role)!;
  const { model, displayName } = ctx.config.client;

  onChange(run);
  try {
    for (let s = 0; s < plan.sets.length; s++) {
      for (const q of ctx.questions) {
        if (signal?.aborted) return stop("aborted");
        const retrieved: string[] = [];
        const bodies: AskBody[] = [];
        const transport: AskTransport = { send: (body, sig) => (bodies.push(body), ctx.transport.send(body, sig)) };
        const qa = { retriever: settingsRetriever(ctx.retriever, plan.sets[s], retrieved), transport, model, displayName };
        const answer = await ask(qa, { identityId: q.role, text: q.question, language: q.language }, undefined, signal);
        if (signal?.aborted) return stop("aborted");
        const error = answerError(answer);
        if (error !== undefined && STOP_ERRORS.has(error)) return stop(error);

        const result: QuestionResult = { question: q.id, answer, score: scoreQuestion(q, { retrieved, bodies, answer }, leaks(q.role)) };
        if (plan.mode === "model" && q.expect === "answer" && answer.kind === "answer" && q.referenceAnswer !== null) {
          const graded = await gradeAnswer({ transport: ctx.transport, model }, { question: q.question, reference: q.referenceAnswer, answer: answer.text }, signal);
          if (signal?.aborted) return stop("aborted");
          result.grade = graded.grade;
          if (graded.error !== undefined) result.gradeError = graded.error;
        }
        update({ sets: run.sets.map((set, i) => (i === s ? { ...set, results: [...set.results, result] } : set)) });
        // 模型評分遇到 STOP_ERRORS：已花掉一次呼叫的回答先保存（無法評分），再停止（#62 決定（給 PR 3）1）
        if (result.gradeError !== undefined && STOP_ERRORS.has(result.gradeError)) return stop(result.gradeError);
      }
    }
  } catch (e) {
    // 離開評測台時先中止再關閉資料庫：進行中的檢索可能因資料庫已關閉而失敗，記為停止，不停在「執行中」（#66）
    if (signal?.aborted) return stop("aborted");
    throw e;
  }
  return update({ status: "done", finishedAt: new Date().toISOString() });
}
