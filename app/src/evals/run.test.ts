// 評測的執行：測試只使用假的 /api/ask（fakeTransport），不呼叫真實 API。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import type { Database } from "../db/database";
import { answered, fakeTransport } from "../qa/testing";
import type { AskBody, AskEvent } from "../qa/types";
import { openRetriever } from "../retrieval/retrieve";
import { GRADE_SYSTEM_PROMPT } from "./grade";
import { evalQuestions } from "./load";
import { estimateCalls, openEvalDatabase, runEvals, type EvalContext, type EvalRun, type EvalSettings } from "./run";
import { summarize } from "./score";

const { retrieval, evals } = clientConfig.client;
const DEFAULT: EvalSettings = { topK: retrieval.topK, minScore: retrieval.minScore };
const all = evalQuestions.questions;
const pick = (...ids: string[]) => ids.map((id) => all.find((q) => q.id === id)!);
// 會送出的回答題、本機就拒答的題庫外問題（檢索不到段落）、英文的矛盾題、主管才看得到的回答題
const sample = pick("annual-leave-staff", "weather-staff", "bluewing-launch-staff-en", "bluewing-cost-manager");

let db: Database;
beforeAll(async () => {
  db = await openEvalDatabase(clientConfig, dataset);
});
afterAll(async () => {
  await db.close();
});

const isGrade = (body: AskBody) => body.system === GRADE_SYSTEM_PROMPT;
// 問答回一個引用第 1 段的回答，模型評分回 correct
const reply = (grade = '{"verdict":"correct","reason":"ok"}') => (body: AskBody): AskEvent[] => (isGrade(body) ? answered(grade) : answered("第二季 Q3 7 天 [1]"));

const context = (questions = sample, send: (body: AskBody) => AskEvent[] = reply()) => {
  const transport = fakeTransport(send);
  const ctx: EvalContext = { retriever: openRetriever(db, retrieval), transport, config: clientConfig, data: dataset, questions };
  return { ctx, transport };
};

describe("estimateCalls", () => {
  it.each(["keyPoints", "model"] as const)("與實際送出的次數相同（%s）", async (mode) => {
    const { ctx, transport } = context(all);
    const estimate = await estimateCalls(ctx, [DEFAULT], mode);
    const run = await runEvals(ctx, { sets: [DEFAULT], mode });
    expect(run.status).toBe("done");
    expect(estimate.total).toBe(transport.bodies.length);
    expect(estimate.ask).toBe(transport.bodies.filter((b) => !isGrade(b)).length);
    expect(estimate.grade).toBe(mode === "model" ? transport.bodies.filter(isGrade).length : 0);
    expect(estimate.ask).toBeGreaterThan(0);
    // 有些題目在本機就拒答，不呼叫
    expect(estimate.ask).toBeLessThan(all.length);
  });

  it("兩組設定各算一次；門檻高到檢索不到段落時為 0", async () => {
    const { ctx } = context();
    const one = await estimateCalls(ctx, [DEFAULT], "keyPoints");
    expect(await estimateCalls(ctx, [DEFAULT, DEFAULT], "keyPoints")).toEqual({ ask: one.ask * 2, grade: 0, total: one.ask * 2 });
    expect(await estimateCalls(ctx, [{ topK: 5, minScore: 1.01 }], "model")).toEqual({ ask: 0, grade: 0, total: 0 });
  });
});

describe("runEvals", () => {
  it("每題以題庫的角色與語言執行，依設定的 topK 檢索；兩組設定依序跑完", async () => {
    const { ctx, transport } = context();
    const changes: EvalRun[] = [];
    const run = await runEvals(ctx, { sets: [DEFAULT, { topK: 1, minScore: 0 }], mode: "keyPoints" }, (r) => changes.push(r));
    expect(run).toMatchObject({ status: "done", mode: "keyPoints" });
    expect(run.finishedAt).toBeDefined();
    expect(run.sets.map((s) => s.results.map((r) => r.question))).toEqual([sample.map((q) => q.id), sample.map((q) => q.id)]);
    // 設定 B 的每次問答只送出一段
    const b = transport.bodies.slice(transport.bodies.length / 2);
    for (const body of b) expect(body.messages[0].content.match(/<passage number=/g)).toHaveLength(1);
    expect(transport.bodies[0].system).toContain("Answer in Chinese (Taiwan)");
    // 開始、每題完成、結束都通知
    expect(changes).toHaveLength(1 + sample.length * 2 + 1);
    expect(changes.at(-1)).toBe(run);
  });

  it("評分與一般問答相同：本機拒答記為拒答，回答題記下引用", async () => {
    const { ctx } = context();
    const run = await runEvals(ctx, { sets: [DEFAULT], mode: "keyPoints" });
    const byId = new Map(run.sets[0].results.map((r) => [r.question, r]));
    expect(byId.get("weather-staff")!.score).toMatchObject({ outcome: "refusal", refused: true, leaks: [] });
    expect(byId.get("bluewing-cost-manager")!.score).toMatchObject({ outcome: "answer", leaks: [] });
    expect(byId.get("annual-leave-staff")!.score.citation?.cited).toHaveLength(1);
    expect(byId.get("annual-leave-staff")!.grade).toBeUndefined();
  });

  it("遇到 daily_limit 時停止，保留已完成的結果", async () => {
    let calls = 0;
    const { ctx } = context(sample, (body) => (++calls === 2 ? [{ type: "error", error: "daily_limit" }] : reply()(body)));
    const run = await runEvals(ctx, { sets: [DEFAULT, DEFAULT], mode: "keyPoints" });
    expect(run).toMatchObject({ status: "stopped", stopReason: "daily_limit" });
    // 第 1 題送出、第 2 題本機拒答、第 3 題遇到 daily_limit：不記錄
    expect(run.sets[0].results.map((r) => r.question)).toEqual(["annual-leave-staff", "weather-staff"]);
    expect(run.sets[1].results).toEqual([]);
    expect(summarize(sample, run.sets[0].results.map((r) => r.score), evals.thresholds).complete).toBe(false);
  });

  it.each(["invalid_access_code", "global_daily_limit", "network", "upstream_quota"])("%s 也停止", async (error) => {
    const { ctx } = context(sample, () => [{ type: "error", error }]);
    expect(await runEvals(ctx, { sets: [DEFAULT], mode: "keyPoints" })).toMatchObject({ status: "stopped", stopReason: error });
  });

  it("其他錯誤記在該題，接著跑下一題", async () => {
    const { ctx } = context(sample, () => [{ type: "error", error: "upstream_overloaded" }]);
    const run = await runEvals(ctx, { sets: [DEFAULT], mode: "keyPoints" });
    expect(run.status).toBe("done");
    expect(run.sets[0].results).toHaveLength(sample.length);
    expect(run.sets[0].results[0].score).toMatchObject({ outcome: "error", error: "upstream_overloaded", citation: { pass: false } });
  });

  it("按停止時中止進行中的題目，不記錄該題", async () => {
    const controller = new AbortController();
    const { ctx } = context();
    const run = await runEvals(ctx, { sets: [DEFAULT], mode: "keyPoints" }, (r) => r.sets[0].results.length === 1 && controller.abort(), controller.signal);
    expect(run).toMatchObject({ status: "stopped", stopReason: "aborted" });
    expect(run.sets[0].results).toHaveLength(1);
  });

  it("中止後檢索因資料庫關閉而失敗：記為停止，不停在執行中", async () => {
    const controller = new AbortController();
    const { ctx } = context();
    const closing: EvalContext = {
      ...ctx,
      retriever: {
        retrieve: async () => {
          controller.abort();
          throw new Error("database closed");
        },
      },
    };
    const seen: EvalRun[] = [];
    const run = await runEvals(closing, { sets: [DEFAULT], mode: "keyPoints" }, (r) => seen.push(r), controller.signal);
    expect(run).toMatchObject({ status: "stopped", stopReason: "aborted" });
    expect(seen.at(-1)?.status).toBe("stopped");
  });

  it("沒有中止時的例外照常拋出", async () => {
    const { ctx } = context();
    const broken: EvalContext = { ...ctx, retriever: { retrieve: async () => Promise.reject(new Error("boom")) } };
    await expect(runEvals(broken, { sets: [DEFAULT], mode: "keyPoints" })).rejects.toThrow("boom");
  });
});

describe("runEvals：模型評分", () => {
  it("只對有回答的回答題呼叫，判定記在該題", async () => {
    const { ctx, transport } = context();
    const run = await runEvals(ctx, { sets: [DEFAULT], mode: "model" });
    const graded = run.sets[0].results.filter((r) => r.grade !== undefined).map((r) => r.question);
    expect(graded).toEqual(["annual-leave-staff", "bluewing-launch-staff-en", "bluewing-cost-manager"]);
    expect(transport.bodies.filter(isGrade)).toHaveLength(3);
    expect(transport.bodies.find(isGrade)!.messages[0].content).toContain("<answer>\n第二季 Q3 7 天 [1]\n</answer>");
    const scores = run.sets[0].results.map((r) => r.score);
    const grades = new Map(run.sets[0].results.flatMap((r) => (r.grade ? [[r.question, r.grade] as const] : [])));
    expect(summarize(sample, scores, evals.thresholds, "model", grades).answer).toMatchObject({ passed: 3, total: 3, ungradable: 0 });
  });

  it("輸出格式錯誤時記為無法評分，不當成正確", async () => {
    const { ctx } = context(sample, reply("Correct!"));
    const run = await runEvals(ctx, { sets: [DEFAULT], mode: "model" });
    const results = run.sets[0].results;
    expect(results.find((r) => r.question === "annual-leave-staff")!.grade).toEqual({ verdict: "ungradable", reason: null });
    const grades = new Map(results.flatMap((r) => (r.grade ? [[r.question, r.grade] as const] : [])));
    expect(summarize(sample, results.map((r) => r.score), evals.thresholds, "model", grades).answer).toMatchObject({ passed: 0, total: 3, ungradable: 3 });
  });

  it("模型評分遇到 daily_limit 時保存這題（無法評分）再停止；其他錯誤記為無法評分", async () => {
    const limited = context(sample, (body) => (isGrade(body) ? [{ type: "error", error: "daily_limit" }] : reply()(body)));
    const stopped = await runEvals(limited.ctx, { sets: [DEFAULT], mode: "model" });
    expect(stopped).toMatchObject({ status: "stopped", stopReason: "daily_limit" });
    expect(stopped.sets[0].results).toHaveLength(1);
    expect(stopped.sets[0].results[0]).toMatchObject({
      question: "annual-leave-staff",
      answer: { kind: "answer" },
      grade: { verdict: "ungradable", reason: null },
      gradeError: "daily_limit",
    });

    const overloaded = context(sample, (body) => (isGrade(body) ? [{ type: "error", error: "upstream_overloaded" }] : reply()(body)));
    const run = await runEvals(overloaded.ctx, { sets: [DEFAULT], mode: "model" });
    expect(run.status).toBe("done");
    expect(run.sets[0].results[0]).toMatchObject({ grade: { verdict: "ungradable", reason: null }, gradeError: "upstream_overloaded" });
  });
});
