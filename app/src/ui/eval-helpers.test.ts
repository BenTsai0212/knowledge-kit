import { afterEach, describe, expect, it, vi } from "vitest";
import { clientConfig } from "../client/load";
import type { EvalRun, QuestionResult, SetRun } from "../evals/run";
import type { QuestionScore } from "../evals/score";
import { evalQuestions } from "../evals/load";
import type { RetrievalConfig } from "../client/types";
import { keywordHashProvider } from "../retrieval/keyword-hash";
import { createProvider, PROVIDERS, RETRIEVAL_DEFAULTS, withRetrievalDefaults } from "../retrieval/providers";
import css from "./app.css?raw";
import { bankSummary, createEvalDatabases, differs, effectiveForm, evalReport, outcome, parseReportSource, parseSettings, progressCells, setSummary, settingsForm, verdicts } from "./eval-helpers";
import { MOTION, STAGGER } from "./motion";

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

describe("effectiveForm（#178）", () => {
  afterEach(() => vi.restoreAllMocks());
  const semantic = withRetrievalDefaults({ provider: "multilingual-e5-small" });
  // 語意模型不下載：成功時以 keyword-hash 代替，失敗時拋錯
  const ready = (config: RetrievalConfig, fails: boolean) =>
    createProvider(config, {
      ...PROVIDERS,
      "multilingual-e5-small": async () => {
        if (fails) throw new Error("model failed");
        return keywordHashProvider;
      },
    });

  it("沒有降級：預設值與 client.retrieval 相同", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const config of [clientConfig.client.retrieval, withRetrievalDefaults(), semantic]) {
      const { options, fallback } = await ready(config, false);
      expect(fallback).toBeNull();
      expect(effectiveForm(settingsForm(config), options)).toEqual(settingsForm(config));
    }
  });

  it("降級：minScore 改為 keyword-hash 的預設值，topK 不變", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = { ...semantic, topK: 7 };
    const { options, fallback } = await ready(config, true);
    expect(fallback).not.toBeNull();
    expect(effectiveForm(settingsForm(config), options)).toEqual({ topK: "7", minScore: String(RETRIEVAL_DEFAULTS["keyword-hash"].minScore), edited: {} });
  });

  it("人已改過的欄位不覆蓋", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { options } = await ready(semantic, true);
    const minScore = { ...settingsForm(semantic), minScore: "0.5", edited: { minScore: true as const } };
    expect(effectiveForm(minScore, options)).toEqual({ ...minScore, topK: String(semantic.topK) });
    const both = { topK: "3", minScore: "0.9", edited: { topK: true as const, minScore: true as const } };
    expect(effectiveForm(both, options)).toEqual(both);
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
  const meta = { model: clientConfig.client.model, questionBank: { hash: "0123456789ab", questions: 58 } };

  it("包含模型、題庫版本、設定、門檻、每組的指標與結果、時間；不含邀請碼", () => {
    const set: SetRun = { settings: { topK: 5, minScore: 0.1 }, results: [result({ id: questions[0].id })] };
    const run: EvalRun = { mode: "keyPoints", providerId: "keyword-hash", sets: [set], status: "stopped", stopReason: "daily_limit", startedAt: "2026-10-30T00:00:00.000Z" };
    const report = evalReport(run, questions, thresholds, meta);
    expect(report).toMatchObject({ mode: "keyPoints", provider: "keyword-hash", model: meta.model, questionBank: meta.questionBank, notApplicable: [], status: "stopped", stopReason: "daily_limit", finishedAt: null, thresholds: { ...thresholds, leakage: 0 } });
    expect(report.sets[0].settings).toEqual(set.settings);
    expect(report.sets[0].summary).toEqual(setSummary(questions, set, thresholds, "keyPoints"));
    expect(report.sets[0].summary.complete).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/access/i);
  });

  it("keyword-hash 時 requires: semantic 的題目列為不適用，不計入指標的分母（#163 決定 3）", () => {
    const semantic = { ...questions[1], id: "semantic-only", requires: "semantic" as const };
    const all = [...questions, semantic];
    const set: SetRun = { settings: { topK: 5, minScore: 0.1 }, results: questions.map((q) => result({ id: q.id })) };
    const run = (providerId: EvalRun["providerId"]): EvalRun => ({ mode: "keyPoints", providerId, sets: [set], status: "done", startedAt: "2026-10-30T00:00:00.000Z" });
    const keyword = evalReport(run("keyword-hash"), all, thresholds, meta);
    expect(keyword.notApplicable).toEqual(["semantic-only"]);
    expect(keyword.sets[0].summary).toMatchObject({ done: 2, total: 2, complete: true });
    const e5 = evalReport(run("multilingual-e5-small"), all, thresholds, meta);
    expect(e5.notApplicable).toEqual([]);
    expect(e5.sets[0].summary).toMatchObject({ done: 2, total: 3, complete: false });
  });
});

describe("parseReportSource（品質報告的第二份輸入，#210）", () => {
  const set: SetRun = { settings: { topK: 5, minScore: 0.1 }, results: questions.map((q) => result({ id: q.id })) };
  const run: EvalRun = { mode: "keyPoints", providerId: "keyword-hash", sets: [set], status: "done", startedAt: "2026-10-30T00:00:00.000Z", finishedAt: "2026-10-30T00:05:00.000Z" };
  const json = JSON.stringify(evalReport(run, questions, thresholds, { model: clientConfig.client.model, questionBank: { hash: "0123456789ab", questions: 2 } }));

  it("下載 JSON 原樣讀回；沒有題庫版本的舊格式也可以", () => {
    expect(parseReportSource(json)).toEqual(JSON.parse(json));
    const { questionBank: _bank, model: _model, ...legacy } = JSON.parse(json);
    expect(parseReportSource(JSON.stringify(legacy))).toEqual(legacy);
  });

  it("不是 JSON 或形狀不對時為 null", () => {
    const base = JSON.parse(json);
    const broken = [
      "not json",
      "[]",
      JSON.stringify({ ...base, mode: "other" }),
      JSON.stringify({ ...base, sets: [] }),
      JSON.stringify({ ...base, finishedAt: 1 }),
      JSON.stringify({ ...base, questionBank: { hash: 1 } }),
      JSON.stringify({ ...base, sets: [{ ...base.sets[0], summary: { ...base.sets[0].summary, answer: null } }] }),
      JSON.stringify({ ...base, sets: [{ ...base.sets[0], results: [{ question: "q" }] }] }),
    ];
    expect(broken.map(parseReportSource)).toEqual(broken.map(() => null));
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

describe("每題的結果、題庫摘要與進度格（#244）", () => {
  it("全部通過：回答題是正確、拒答題是正確拒答；任一指標未通過、滲漏或錯誤是不正確", () => {
    expect(outcome(answerQ, result(), "keyPoints")).toBe("correct");
    expect(outcome(refusalQ, result({ id: refusalQ.id, citation: null, keyPoints: null, refused: true }), "keyPoints")).toBe("refused");
    expect(outcome(refusalQ, result({ id: refusalQ.id, citation: null, keyPoints: null, refused: false }), "keyPoints")).toBe("incorrect");
    expect(outcome(answerQ, result({ citation: { pass: false, cited: [], dropped: [] } }), "keyPoints")).toBe("incorrect");
    expect(outcome(answerQ, result({ keyPoints: { pass: false, points: [] } }), "keyPoints")).toBe("incorrect");
    expect(outcome(answerQ, result({ leaks: [{ kind: "document", document: "d" } as never] }), "keyPoints")).toBe("incorrect");
    expect(outcome(answerQ, result({ error: "network" }), "keyPoints")).toBe("incorrect");
  });

  it("題庫摘要的題數、身分數、類別數取自題庫", () => {
    const all = evalQuestions.questions;
    expect(bankSummary(all)).toEqual({ questions: all.length, roles: new Set(all.map((q) => q.role)).size, categories: new Set(all.map((q) => q.category)).size });
    expect(bankSummary([answerQ, answerQ])).toEqual({ questions: 2, roles: 1, categories: 1 });
  });

  it("進度格：每組 × 適用的題目各一格，先設定 A 再設定 B；還沒回來的是 null", () => {
    const qs = [answerQ, refusalQ];
    const run: EvalRun = {
      mode: "keyPoints",
      providerId: "keyword-hash",
      status: "running",
      startedAt: "2026-11-11T00:00:00.000Z",
      sets: [
        { settings: { topK: 5, minScore: 0.2 }, results: [result(), result({ id: refusalQ.id, citation: null, keyPoints: null, refused: false })] },
        { settings: { topK: 3, minScore: 0.2 }, results: [result()] },
      ],
    };
    expect(progressCells(run, qs)).toEqual(["correct", "incorrect", "correct", null]);
  });

  it("動態：進度格以 kGrow（linear）填滿；完成時四項指標以 kPopS 依序彈出，延遲 900／960／1020／1080ms 寫成 --motion-* 的組合", () => {
    const rule = (selector: string) => css.match(new RegExp(`\\n${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule(".eval-cell")).toContain("animation: kGrow var(--motion-base) var(--ease-linear) backwards;");
    expect(rule(".eval-summary.settled .eval-verdict")).toContain(
      "animation: kPopS var(--motion-settle) var(--ease-spring) calc(3 * var(--motion-expand) + var(--i, 0) * var(--motion-stagger-list)) backwards;",
    );
    expect([0, 1, 2, 3].map((i) => 3 * MOTION.expand + i * STAGGER.list)).toEqual([900, 960, 1020, 1080]);
  });
});
