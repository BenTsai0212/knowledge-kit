import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import type { EvalRun, QuestionResult, SetRun } from "../evals/run";
import type { QuestionScore } from "../evals/score";
import { evalQuestions } from "../evals/load";
import { createEvalDatabases, differs, evalReport, parseSettings, setSummary, verdicts } from "./eval-helpers";

const { thresholds } = clientConfig.client.evals;
const questions = evalQuestions.questions.slice(0, 2);
const [answerQ, refusalQ] = [evalQuestions.questions.find((q) => q.expect === "answer")!, evalQuestions.questions.find((q) => q.expect === "refusal")!];

const score = (patch: Partial<QuestionScore>): QuestionScore => ({
  id: answerQ.id,
  outcome: "answer",
  error: null,
  citation: { pass: true, cited: [], dropped: [] },
  keyPoints: { pass: true, points: [] },
  refused: null,
  leaks: [],
  ...patch,
});
const result = (patch: Partial<QuestionScore> = {}, extra: Partial<QuestionResult> = {}): QuestionResult => ({
  question: patch.id ?? answerQ.id,
  // 輔助函式只看 score 與 grade
  answer: { kind: "refusal", text: "x" },
  score: score(patch),
  ...extra,
});

describe("parseSettings", () => {
  it("topK 是 1–20 的整數，minScore 介於 0 到 1", () => {
    expect(parseSettings("5", "0.2")).toEqual({ topK: 5, minScore: 0.2 });
    expect(parseSettings("20", "1")).toEqual({ topK: 20, minScore: 1 });
    expect(parseSettings("1", "0")).toEqual({ topK: 1, minScore: 0 });
    for (const [k, m] of [["0", "0.1"], ["21", "0.1"], ["2.5", "0.1"], ["", "0.1"], ["5", ""], ["5", "-0.1"], ["5", "1.5"], ["5", "abc"]]) {
      expect(parseSettings(k, m), `${k} ${m}`).toBeNull();
    }
  });
});

describe("verdicts／differs", () => {
  it("各指標的結果；不適用的為 null", () => {
    expect(verdicts(result(), "keyPoints")).toEqual({ citation: true, answer: true, leaked: false, refusal: null });
    const refused = result({ id: refusalQ.id, outcome: "refusal", citation: null, keyPoints: null, refused: true });
    expect(verdicts(refused, "keyPoints")).toEqual({ citation: null, answer: null, leaked: false, refusal: true });
  });

  it("模型評分時答案正確依判定，無法評分不算正確", () => {
    expect(verdicts(result({}, { grade: { verdict: "correct", reason: "ok" } }), "model").answer).toBe(true);
    expect(verdicts(result({}, { grade: { verdict: "ungradable", reason: null } }), "model").answer).toBe(false);
  });

  it("任一指標不同時標示；有一組沒跑完時不標示", () => {
    expect(differs(result(), result(), "keyPoints")).toBe(false);
    expect(differs(result(), result({ citation: { pass: false, cited: [], dropped: [1] } }), "keyPoints")).toBe(true);
    expect(differs(result(), result({ leaks: [{ kind: "forbidden", term: "8500" }] }), "keyPoints")).toBe(true);
    expect(differs(result(), undefined, "keyPoints")).toBe(false);
  });
});

describe("evalReport", () => {
  it("包含設定、門檻、每組的指標與結果、時間；不含邀請碼", () => {
    const set: SetRun = { settings: { topK: 5, minScore: 0.1 }, results: [result({ id: questions[0].id })] };
    const run: EvalRun = { mode: "keyPoints", sets: [set], status: "stopped", stopReason: "daily_limit", startedAt: "2026-10-30T00:00:00.000Z" };
    const report = evalReport(run, questions, thresholds);
    expect(report).toMatchObject({ mode: "keyPoints", status: "stopped", stopReason: "daily_limit", finishedAt: null, thresholds });
    expect(report.sets[0].settings).toEqual(set.settings);
    expect(report.sets[0].summary).toEqual(setSummary(questions, set, thresholds, "keyPoints"));
    expect(report.sets[0].summary.complete).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/access/i);
  });
});

describe("createEvalDatabases", () => {
  const fake = () => {
    const log: string[] = [];
    let n = 0;
    const dbs = createEvalDatabases(async () => {
      const id = ++n;
      log.push(`open ${id}`);
      return { id, close: async () => void log.push(`close ${id}`) };
    });
    return { log, dbs };
  };

  it("同一時間只開一個：舊的關閉後才開新的", async () => {
    const { log, dbs } = fake();
    await dbs.open();
    await dbs.open();
    await dbs.close();
    await dbs.close();
    expect(log).toEqual(["open 1", "close 1", "open 2", "close 2"]);
  });

  it("開啟中就關閉時，開好後關閉", async () => {
    const { log, dbs } = fake();
    const opening = dbs.open();
    await dbs.close();
    await opening;
    expect(log).toEqual(["open 1", "close 1"]);
  });
});
