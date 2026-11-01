// 評測台畫面（EvalPage.tsx）用的純函式：設定表單、各組的指標、兩組差異、下載 JSON，以及評測專用資料庫的開關。
import type { EvalThresholds } from "../client/types";
import type { EvalRun, EvalSettings, QuestionResult, SetRun } from "../evals/run";
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

// 下載 JSON 的內容：設定、門檻（含固定的權限滲漏上限，格式與門檻可設定時相同）、每組的指標與每題結果、開始與結束時間；不含邀請碼
export function evalReport(run: EvalRun, questions: EvalQuestion[], thresholds: EvalThresholds) {
  return {
    mode: run.mode,
    status: run.status,
    stopReason: run.stopReason ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    thresholds: { ...thresholds, leakage: LEAKAGE_LIMIT },
    sets: run.sets.map((set) => ({
      settings: set.settings,
      summary: setSummary(questions, set, thresholds, run.mode),
      results: set.results,
    })),
  };
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
