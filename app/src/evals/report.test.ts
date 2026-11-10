// 品質報告的內容（#210）：彙總、兩次比較、覆蓋範圍、題庫版本與機密過濾。以參考情境的題庫與資料集組成假的評測結果，不呼叫 API。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { dataset, type Dataset } from "../dataset/load";
import { evalQuestions } from "./load";
import { coverage, failedMetrics, qualityReport, questionBank, restrictedRoles, type ReportInput, type ReportSource } from "./report";
import type { QuestionResult } from "./run";
import { summarize, type AnswerMode, type QuestionScore } from "./score";
import type { EvalQuestion } from "./types";

const { access } = clientConfig;
const { thresholds } = clientConfig.client.evals;
const questions = evalQuestions.questions;
const SETTINGS = { topK: 5, minScore: 0.1 };
const BANK = { hash: "0123456789ab", questions: questions.length };
const ANSWER_TEXT = "回答內文：這段文字不應出現在報告中";

// 全部通過的結果；fail 列出的題目在指定指標失敗
function resultFor(q: EvalQuestion, fail: Partial<Record<"citation" | "answer" | "leakage" | "refusal", true>> = {}): QuestionResult {
  const answers = q.expect === "answer";
  const score: QuestionScore = {
    id: q.id,
    outcome: answers || fail.refusal ? "answer" : "refusal",
    error: null,
    citation: answers ? { pass: !fail.citation, cited: [], dropped: [] } : null,
    keyPoints: answers ? { pass: !fail.answer, points: q.keyPoints.map((synonyms) => ({ synonyms, matched: synonyms[0] })) } : null,
    refused: answers ? null : !fail.refusal,
    leaks: fail.leakage ? [{ kind: "forbidden", term: q.forbidden[0]?.[0] ?? "x" }, { kind: "retrieved", passage: "p" }] : [],
  };
  const answer = answers || fail.refusal ? { kind: "answer" as const, text: ANSWER_TEXT, cited: [], dropped: [], citations: [] } : { kind: "refusal" as const, text: "x" };
  return { question: q.id, answer: answer as QuestionResult["answer"], score, calls: answers ? 1 : 0 };
}

function source(results: QuestionResult[], patch: Partial<ReportSource> = {}, mode: AnswerMode = "keyPoints"): ReportSource {
  const summary = summarize(questions, results.map((r) => r.score), thresholds, mode);
  return {
    mode,
    provider: "keyword-hash",
    model: clientConfig.client.model,
    questionBank: BANK,
    notApplicable: [],
    status: "done",
    startedAt: "2026-11-10T00:00:00.000Z",
    finishedAt: "2026-11-10T00:10:00.000Z",
    sets: [{ settings: SETTINGS, summary, results }],
    ...patch,
  };
}

const input = (current: ReportSource, previous: ReportSource | null = null): ReportInput => ({ questions, access, data: dataset, thresholds, current, set: 0, previous });
const allPass = () => questions.map((q) => resultFor(q));
const restricted = restrictedRoles(access);
const restrictedQ = questions.find((q) => restricted.has(q.role) && q.expect === "answer")!;
const openQ = questions.find((q) => !restricted.has(q.role) && q.expect === "answer")!;

describe("questionBank", () => {
  it("SHA-256 的前 12 碼：同一內容同一值，改一個字就不同", async () => {
    // SHA-256("abc") = ba7816bf8f01cfea…
    expect(await questionBank("abc", 1)).toEqual({ hash: "ba7816bf8f01", questions: 1 });
    const text = JSON.stringify(evalQuestions);
    expect((await questionBank(text, 58)).hash).toBe((await questionBank(text, 58)).hash);
    expect((await questionBank(text.replace("?", "？"), 58)).hash).not.toBe((await questionBank(text, 58)).hash);
  });
});

describe("coverage", () => {
  it("答案段落所屬的文件數／資料集的文件數，並依可見等級列出", () => {
    const docs = Object.values(dataset.documents);
    const [a, b] = [docs[0], docs[1]];
    const qs = [
      { ...questions[0], answerPassages: [a.passages[0].id, a.passages.at(-1)!.id] },
      { ...questions[1], answerPassages: [b.passages[0].id, "not-a-passage"] },
    ];
    const c = coverage(qs, dataset, access);
    expect(c).toMatchObject({ covered: 2, total: docs.length });
    expect(c.levels.map((l) => l.level)).toEqual([...access.visibilityLevels].sort((x, y) => x.rank - y.rank).map((l) => l.id));
    expect(c.levels.reduce((n, l) => n + l.total, 0)).toBe(docs.length);
    expect(c.levels.reduce((n, l) => n + l.covered, 0)).toBe(2);
    expect(coverage([], dataset, access).covered).toBe(0);
  });

  it("分母是資料集的文件數（不含上傳的文件）", () => {
    const one: Dataset = { ...dataset, documents: Object.fromEntries(Object.entries(dataset.documents).slice(0, 1)) };
    expect(coverage(questions, one, access).total).toBe(1);
  });
});

describe("restrictedRoles", () => {
  it("可見等級是最高等級的身分", () => {
    const top = [...access.visibilityLevels].sort((x, y) => y.rank - x.rank)[0].id;
    expect([...restricted]).toEqual(access.roles.filter((r) => r.visibility === top).map((r) => r.id));
    expect(restricted.size).toBeGreaterThan(0);
  });
});

describe("failedMetrics", () => {
  it("只列沒有通過的指標，不適用的不列", () => {
    const refusalQ = questions.find((q) => q.expect === "refusal")!;
    expect(failedMetrics(resultFor(openQ), "keyPoints")).toEqual([]);
    expect(failedMetrics(resultFor(openQ, { citation: true, leakage: true }), "keyPoints")).toEqual(["citation", "leakage"]);
    expect(failedMetrics(resultFor(refusalQ, { refusal: true }), "keyPoints")).toEqual(["refusal"]);
    // 模型評分時依判定
    expect(failedMetrics({ ...resultFor(openQ), grade: { verdict: "ungradable", reason: null } }, "model")).toEqual(["answer"]);
  });
});

describe("qualityReport：一次", () => {
  it("全部通過：標題的題數、滲漏 0、沒有未達的指標；四個指標對照門檻", () => {
    const r = qualityReport(input(source(allPass())));
    expect(r.headline).toEqual({ questions: questions.length, leaked: 0, unmet: [], second: null });
    expect(r.metrics.map((m) => [m.key, m.meets, m.second, m.bothMeet])).toEqual([
      ["citation", true, null, null],
      ["answer", true, null, null],
      ["leakage", true, null, null],
      ["refusal", true, null, null],
    ]);
    expect(r.metrics.find((m) => m.key === "leakage")).toMatchObject({ passed: 0, threshold: 0 });
    expect(r.metrics.find((m) => m.key === "answer")!.threshold).toBe(thresholds.answer);
    expect(r.stability).toBeNull();
    expect(r.failures).toEqual([]);
    expect(r.restrictedFailures).toBe(0);
  });

  it("未達門檻的指標寫進標題；滲漏計入身分", () => {
    const results = questions.map((q) => resultFor(q, q.expect === "answer" ? { answer: true } : {}));
    results[questions.indexOf(openQ)] = resultFor(openQ, { answer: true, leakage: true });
    const r = qualityReport(input(source(results)));
    expect(r.headline).toMatchObject({ leaked: 1, unmet: ["answer", "leakage"] });
    const role = r.roles.find((x) => x.role === openQ.role)!;
    expect(role).toMatchObject({ leaked: 1, restricted: false });
    expect(role.questions).toBe(questions.filter((q) => q.role === openQ.role).length);
    expect(r.roles.map((x) => x.role)).toEqual(access.roles.map((x) => x.id).filter((id) => questions.some((q) => q.role === id)));
  });

  it("身分 × 類別：通過數／題數；最高可見等級的身分只有彙總，不列題目 id", () => {
    const results = allPass();
    results[questions.indexOf(openQ)] = resultFor(openQ, { citation: true });
    results[questions.indexOf(restrictedQ)] = resultFor(restrictedQ, { answer: true });
    const r = qualityReport(input(source(results)));
    expect(r.matrix.reduce((n, c) => n + c.total, 0)).toBe(questions.length);
    expect(r.matrix.find((c) => c.role === openQ.role && c.category === openQ.category)).toMatchObject({
      passed: questions.filter((q) => q.role === openQ.role && q.category === openQ.category).length - 1,
    });
    expect(r.matrix.find((c) => c.role === restrictedQ.role && c.category === restrictedQ.category)).toMatchObject({
      passed: questions.filter((q) => q.role === restrictedQ.role && q.category === restrictedQ.category).length - 1,
    });
    expect(r.failures).toEqual([{ id: openQ.id, role: openQ.role, category: openQ.category, failed: ["citation"] }]);
    expect(r.restrictedFailures).toBe(1);
    expect(r.roles.find((x) => x.role === restrictedQ.role)!.restricted).toBe(true);
  });

  it("測試條件：題庫版本、設定、provider、不適用的題數、模型、日期、呼叫次數；舊格式沒有呼叫次數時為 null", () => {
    const r = qualityReport(input(source(allPass(), { notApplicable: ["a", "b"] })));
    expect(r.conditions).toEqual({
      bank: BANK,
      settings: SETTINGS,
      provider: "keyword-hash",
      notApplicable: 2,
      mode: "keyPoints",
      model: clientConfig.client.model,
      startedAt: "2026-11-10T00:00:00.000Z",
      finishedAt: "2026-11-10T00:10:00.000Z",
      calls: questions.filter((q) => q.expect === "answer").length,
    });
    const old = allPass().map(({ calls: _calls, ...rest }) => rest);
    const legacy = qualityReport(input(source(old, { model: undefined, questionBank: undefined })));
    expect(legacy.conditions).toMatchObject({ calls: null, model: null, bank: null });
  });

  it("沒有跑完時不判定", () => {
    const r = qualityReport(input(source(allPass().slice(0, 10), { status: "stopped" })));
    expect(r.metrics.every((m) => m.meets === null)).toBe(true);
    expect(r.headline.unmet).toEqual([]);
  });
});

describe("qualityReport：兩次", () => {
  it("題庫相同且都跑完：兩次都達到", () => {
    const r = qualityReport(input(source(allPass()), source(allPass(), { startedAt: "2026-11-09T00:00:00.000Z" })));
    expect(r.stability).toEqual({ comparable: true, notes: [], settings: SETTINGS, startedAt: "2026-11-09T00:00:00.000Z", differing: 0 });
    expect(r.metrics.every((m) => m.bothMeet === true && m.second?.meets === true)).toBe(true);
    expect(r.headline.second).toBe("bothMet");
  });

  it("第二次有指標未達：標題寫出，結果不同的題數", () => {
    const worse = questions.map((q) => resultFor(q, q.expect === "answer" ? { citation: true } : {}));
    const r = qualityReport(input(source(allPass()), source(worse)));
    expect(r.headline.second).toBe("secondUnmet");
    expect(r.metrics.find((m) => m.key === "citation")).toMatchObject({ meets: true, second: { meets: false }, bothMeet: false });
    expect(r.stability!.differing).toBe(questions.filter((q) => q.expect === "answer").length);
  });

  it("題庫不同、不明或第二次沒跑完：不算兩次都達到，註明原因", () => {
    const cases: [Partial<ReportSource>, string][] = [
      [{ questionBank: { hash: "ffffffffffff", questions: 58 } }, "bankDiffers"],
      [{ questionBank: undefined }, "bankUnknown"],
      [{ status: "stopped" }, "incomplete"],
    ];
    for (const [patch, note] of cases) {
      const r = qualityReport(input(source(allPass()), source(allPass(), patch)));
      expect(r.stability, note).toMatchObject({ comparable: false, notes: [note], differing: null });
      expect(r.metrics.every((m) => m.bothMeet === null && m.second === null), note).toBe(true);
      expect(r.headline.second, note).toBeNull();
    }
  });

  it("優先用設定相同的那一組；找不到時用第一組並註明", () => {
    const prev = source(allPass());
    const other = { ...prev.sets[0], settings: { topK: 8, minScore: 0.3 } };
    const same = qualityReport(input(source(allPass()), { ...prev, sets: [other, prev.sets[0]] }));
    expect(same.stability).toMatchObject({ comparable: true, notes: [], settings: SETTINGS });
    const differ = qualityReport(input(source(allPass()), { ...prev, sets: [other] }));
    expect(differ.stability).toMatchObject({ comparable: true, notes: ["settingsDiffer"], settings: other.settings });
  });
});

describe("qualityReport：機密（#210 決定 3）", () => {
  it("不含題目文字、回答、段落文字、keyPoints、forbidden、referenceAnswer 與滲漏的 term", () => {
    const results = questions.map((q) => resultFor(q, { leakage: true, ...(q.expect === "answer" ? { answer: true } : { refusal: true }) }));
    const text = JSON.stringify(qualityReport(input(source(results), source(results))));
    const passages = Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => p.text));
    const secrets = [
      ANSWER_TEXT,
      ...questions.map((q) => q.question),
      ...questions.flatMap((q) => [...q.keyPoints.flat(), ...q.forbidden.flat(), q.referenceAnswer ?? ""]),
      ...passages,
    ].filter((s) => s.length >= 4);
    expect(secrets.length).toBeGreaterThan(100);
    expect(secrets.filter((s) => text.includes(s))).toEqual([]);
  });

  it("最高可見等級的身分的題目 id 不出現", () => {
    const results = questions.map((q) => resultFor(q, { leakage: true }));
    const text = JSON.stringify(qualityReport(input(source(results))));
    const ids = questions.filter((q) => restricted.has(q.role)).map((q) => q.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => text.includes(`"${id}"`))).toEqual([]);
  });
});
