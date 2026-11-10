// 評測台畫面（EvalPage.tsx）用的純函式：設定表單、各組的指標、兩組差異、下載 JSON 與品質報告的第二份輸入，以及評測專用資料庫的開關。
import type { EvalThresholds, ModelCode } from "../client/types";
import { applicableQuestions, type EvalRun, type EvalSettings, type QuestionResult, type SetRun } from "../evals/run";
import type { QuestionBank, ReportSource } from "../evals/report";
import { answerCorrect, LEAKAGE_LIMIT, summarize, type AnswerMode, type ModelGrade, type Summary } from "../evals/score";
import type { EvalQuestion } from "../evals/types";

export const TOP_K_MAX = 20;

// 表單的文字 → 設定；topK 是 1–20 的整數、minScore 介於 0 到 1，否則為 null
export function parseSettings(topK: string, minScore: string): EvalSettings | null {
  const k = Number(topK);
  const m = Number(minScore);
  if (topK.trim() === "" || minScore.trim() === "" || !Number.isInteger(k) || k < 1 || k > TOP_K_MAX) return null;
  if (!Number.isFinite(m) || m < 0 || m > 1) return null;
  return { topK: k, minScore: m };
}

// 一組設定的表單：edited 記下人改過的欄位，這些欄位不換成實際生效的預設值
export interface SettingsForm {
  topK: string;
  minScore: string;
  edited: Partial<Record<"topK" | "minScore", true>>;
}

// 檢索參數 → 還沒改過的表單（預設值）
export const settingsForm = (options: EvalSettings): SettingsForm => ({ topK: String(options.topK), minScore: String(options.minScore), edited: {} });

// provider 準備好後，人還沒改過的欄位換成實際生效的檢索參數（ActiveProvider.options）：降級時 minScore 是 keyword-hash 的預設值（#178）
export function effectiveForm(form: SettingsForm, options: EvalSettings): SettingsForm {
  return {
    ...form,
    topK: form.edited.topK ? form.topK : String(options.topK),
    minScore: form.edited.minScore ? form.minScore : String(options.minScore),
  };
}

export function gradesOf(set: SetRun): Map<string, ModelGrade> {
  return new Map(set.results.flatMap((r) => (r.grade ? [[r.question, r.grade] as const] : [])));
}

export function setSummary(questions: EvalQuestion[], set: SetRun, thresholds: EvalThresholds, mode: AnswerMode): Summary {
  return summarize(questions, set.results.map((r) => r.score), thresholds, mode, gradesOf(set));
}

// 一題在各指標的結果；不適用的指標為 null。leaked 為 true 表示有滲漏
export function verdicts(result: QuestionResult, mode: AnswerMode) {
  const { score } = result;
  return {
    citation: score.citation?.pass ?? null,
    answer: score.keyPoints === null ? null : answerCorrect(score, mode, result.grade),
    leaked: score.leaks.length > 0,
    refusal: score.refused,
  };
}

// 兩組都完成這一題，且任一指標的結果不同
export function differs(a: QuestionResult | undefined, b: QuestionResult | undefined, mode: AnswerMode): boolean {
  if (a === undefined || b === undefined) return false;
  const [x, y] = [verdicts(a, mode), verdicts(b, mode)];
  return (Object.keys(x) as (keyof typeof x)[]).some((k) => x[k] !== y[k]);
}

// 下載 JSON 的內容：provider、模型、題庫版本、不適用的題目、設定、門檻（含固定的權限滲漏上限，格式與門檻可設定時相同）、每組的指標與每題結果、開始與結束時間；不含邀請碼。
// 品質報告（evals/report.ts）以這個內容為輸入，題庫版本用來比對另一次的下載 JSON（#210）
export function evalReport(run: EvalRun, questions: EvalQuestion[], thresholds: EvalThresholds, meta: { model: ModelCode; questionBank: QuestionBank }) {
  const applicable = applicableQuestions(questions, run.providerId);
  return {
    mode: run.mode,
    provider: run.providerId,
    model: meta.model,
    questionBank: meta.questionBank,
    notApplicable: questions.filter((q) => !applicable.includes(q)).map((q) => q.id),
    status: run.status,
    stopReason: run.stopReason ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    thresholds: { ...thresholds, leakage: LEAKAGE_LIMIT },
    sets: run.sets.map((set) => ({
      settings: set.settings,
      summary: setSummary(applicable, set, thresholds, run.mode),
      results: set.results,
    })),
  };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isMetric = (x: unknown) => isObject(x) && typeof x.passed === "number" && typeof x.total === "number" && (x.rate === null || typeof x.rate === "number");

// 品質報告的第二份輸入（另一次的下載 JSON）：檢查報告用到的欄位，形狀不對時為 null（#210）
export function parseReportSource(text: string): ReportSource | null {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(x)) return null;
  const { provider } = x;
  if ((x.mode !== "keyPoints" && x.mode !== "model") || typeof provider !== "string" || typeof x.status !== "string") return null;
  if (typeof x.startedAt !== "string" || !(x.finishedAt === null || typeof x.finishedAt === "string")) return null;
  if (!Array.isArray(x.notApplicable) || !Array.isArray(x.sets) || x.sets.length === 0) return null;
  if (x.questionBank !== undefined && !(isObject(x.questionBank) && (x.questionBank.hash === null || typeof x.questionBank.hash === "string"))) return null;
  const setOk = (set: unknown) =>
    isObject(set) &&
    isObject(set.settings) &&
    typeof set.settings.topK === "number" &&
    typeof set.settings.minScore === "number" &&
    isObject(set.summary) &&
    typeof set.summary.complete === "boolean" &&
    ["citation", "answer", "leakage", "refusal"].every((k) => isMetric((set.summary as Record<string, unknown>)[k])) &&
    Array.isArray(set.results) &&
    set.results.every((r) => isObject(r) && typeof r.question === "string" && isObject(r.score) && Array.isArray(r.score.leaks));
  return x.sets.every(setOk) ? (x as unknown as ReportSource) : null;
}

// 評測專用資料庫：同一時間只開一個，舊的關閉後才開新的；close() 關閉最近開的那個（開啟中也會在開好後關閉），可重複呼叫
export function createEvalDatabases<D extends { close(): Promise<void> }>(open: () => Promise<D>) {
  let current: Promise<D> | null = null;
  const shut = (p: Promise<D> | null) => (p === null ? Promise.resolve() : p.then((db) => db.close(), () => {}));
  return {
    open(): Promise<D> {
      const next = shut(current).then(open);
      current = next;
      return next;
    },
    close(): Promise<void> {
      const opened = current;
      current = null;
      return shut(opened);
    },
  };
}
