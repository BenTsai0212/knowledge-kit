import { describe, expect, it } from "vitest";
import { clientConfig, EVAL_THRESHOLDS_DEFAULTS } from "../client/load";
import { dataset } from "../dataset/load";
import type { Answer } from "../qa/answer";
import { buildPrompt } from "../qa/prompt";
import type { AskBody } from "../qa/types";
import type { RetrievedPassage } from "../retrieval/retrieve";
import {
  findLeaks,
  leakContext,
  LEAKAGE_LIMIT,
  matchSynonyms,
  normalize,
  passagesSection,
  scoreCitation,
  scoreKeyPoints,
  scoreQuestion,
  summarize,
  type LeakContext,
  type ModelGrade,
  type Observation,
  type QuestionScore,
} from "./score";
import type { EvalQuestion } from "./types";

const question = (over: Partial<EvalQuestion> = {}): EvalQuestion => ({
  id: "q",
  role: "staff",
  language: "zh-TW",
  category: "scenario",
  question: "青翼桌什麼時候上市？",
  expect: "answer",
  answerPassages: ["p-launch-zh", "p-launch-en"],
  keyPoints: [["第二季", "Q2"], ["第三季", "Q3"]],
  forbidden: [["8,500", "8500"]],
  referenceAnswer: "第二季，後來延到第三季",
  ...over,
});

const answer = (text: string, cited: string[] = [], dropped: number[] = []): Answer => ({
  kind: "answer",
  text,
  numbering: cited,
  cited,
  dropped,
  uncited: cited.length === 0,
  incomplete: false,
});
const refusal: Answer = { kind: "refusal", text: "沒有資料" };
const error: Answer = { kind: "error", error: "daily_limit" };

const ctx: LeakContext = {
  passages: [
    { id: "p-launch-zh", text: "預計第二季上市" },
    { id: "p-launch-en", text: "Launch moved to Q3 & later" },
    { id: "p-cost", text: "材料成本 8,500 元" },
  ],
  documents: [
    { id: "d-public", title: "進度" },
    { id: "d-secret", title: "成本 <估算>" },
  ],
  visiblePassages: new Set(["p-launch-zh", "p-launch-en"]),
  visibleDocuments: new Set(["d-public"]),
};

const passage = (id: string, content: string, documentTitle: string): RetrievedPassage => ({
  id,
  documentId: id,
  documentTitle,
  documentDate: null,
  language: "zh-TW",
  content,
  score: 1,
  supersededBy: null,
});
const body = (...passages: RetrievedPassage[]): AskBody => {
  const prompt = buildPrompt(passages, "成本 8,500 元是多少？", { companyName: "範例公司", language: "zh-TW" })!;
  return { model: "standard", system: prompt.system, messages: [{ role: "user", content: prompt.user }] };
};
const observe = (a: Answer, over: Partial<Observation> = {}): Observation => ({ retrieved: [], bodies: [], answer: a, ...over });

describe("正規化與同義說法", () => {
  it("NFKC（全形轉半形）、小寫、去掉空白", () => {
    expect(normalize("Ｑ３ 第 三 季\n")).toBe("q3第三季");
    expect(normalize("Vendor  B")).toBe("vendorb");
  });

  it("命中任一個同義說法就算命中，回傳命中的說法", () => {
    expect(matchSynonyms("預計 q3 上市", ["第三季", "Q3"])).toBe("Q3");
    expect(matchSynonyms("約 ８５００ 元", ["8,500", "8500"])).toBe("8500");
    expect(matchSynonyms("7 days", ["7 天", "7 days"])).toBe("7 days");
    expect(matchSynonyms("第二季", ["第三季", "Q3"])).toBeNull();
  });
});

describe("引用正確（每個引用都在答案段落內）", () => {
  const q = question();

  it("全部引用都在答案段落內才算正確", () => {
    expect(scoreCitation(q, answer("x", ["p-launch-zh", "p-launch-en"]))).toEqual({
      pass: true,
      cited: [
        { id: "p-launch-zh", inAnswer: true },
        { id: "p-launch-en", inAnswer: true },
      ],
      dropped: [],
    });
  });

  it("部分引用不在答案段落內：不正確，並標出是哪一個", () => {
    const result = scoreCitation(q, answer("x", ["p-launch-zh", "p-other"]));
    expect(result.pass).toBe(false);
    expect(result.cited).toContainEqual({ id: "p-other", inAnswer: false });
  });

  it("引用了不存在的編號（dropped）：不正確", () => {
    expect(scoreCitation(q, answer("x", ["p-launch-zh"], [9]))).toMatchObject({ pass: false, dropped: [9] });
  });

  it("沒有引用、拒答、錯誤：不正確", () => {
    expect(scoreCitation(q, answer("x")).pass).toBe(false);
    expect(scoreCitation(q, refusal).pass).toBe(false);
    expect(scoreCitation(q, error).pass).toBe(false);
  });
});

describe("關鍵重點", () => {
  const q = question();

  it("每一項都命中（含同義說法、全形、大小寫）才算正確", () => {
    const result = scoreKeyPoints(q, answer("原訂第二季，後來延到 ｑ３。"));
    expect(result).toEqual({
      pass: true,
      points: [
        { synonyms: ["第二季", "Q2"], matched: "第二季" },
        { synonyms: ["第三季", "Q3"], matched: "Q3" },
      ],
    });
  });

  it("少一項就不正確，並標出沒命中的重點", () => {
    const result = scoreKeyPoints(q, answer("預計第三季上市"));
    expect(result.pass).toBe(false);
    expect(result.points.map((p) => p.matched)).toEqual([null, "第三季"]);
  });

  it("拒答或錯誤：不正確，重點都記為沒命中", () => {
    for (const a of [refusal, error]) expect(scoreKeyPoints(q, a)).toEqual({ pass: false, points: q.keyPoints.map((synonyms) => ({ synonyms, matched: null })) });
  });
});

describe("拒答", () => {
  const q = question({ expect: "refusal", keyPoints: [], referenceAnswer: null });

  it("預期拒答：結果是拒答才算；有回答或錯誤都不算", () => {
    expect(scoreQuestion(q, observe(refusal), ctx).refused).toBe(true);
    expect(scoreQuestion(q, observe(answer("第二季")), ctx).refused).toBe(false);
    expect(scoreQuestion(q, observe(error), ctx).refused).toBe(false);
  });

  it("預期拒答的題目不計引用與關鍵重點；預期回答的題目不計拒答", () => {
    expect(scoreQuestion(q, observe(refusal), ctx)).toMatchObject({ citation: null, keyPoints: null });
    expect(scoreQuestion(question(), observe(refusal), ctx).refused).toBeNull();
  });

  it("記下結果的種類與錯誤", () => {
    expect(scoreQuestion(q, observe(error), ctx)).toMatchObject({ outcome: "error", error: "daily_limit" });
    expect(scoreQuestion(q, observe(refusal), ctx)).toMatchObject({ outcome: "refusal", error: null });
  });
});

describe("禁止內容與滲漏", () => {
  const q = question();

  it("沒有滲漏：檢索、送出、引用都在看得到的範圍內", () => {
    const obs = observe(answer("第二季 [1]", ["p-launch-zh"]), {
      retrieved: ["p-launch-zh"],
      bodies: [body(passage("p-launch-zh", "預計第二季上市", "進度"))],
    });
    expect(findLeaks(q, obs, ctx)).toEqual([]);
  });

  it("回答命中禁止內容（同義說法、全形）", () => {
    expect(findLeaks(q, observe(answer("成本約 ８５００ 元")), ctx)).toEqual([{ kind: "forbidden", term: "8500" }]);
  });

  it("拒答的固定文字不檢查禁止內容", () => {
    expect(findLeaks(q, observe({ kind: "refusal", text: "8,500" }), ctx)).toEqual([]);
  });

  it("檢索結果或引用包含看不到的段落", () => {
    const obs = observe(answer("x", ["p-cost"]), { retrieved: ["p-launch-zh", "p-cost", "p-cost"] });
    expect(findLeaks(q, obs, ctx)).toEqual([
      { kind: "retrieved", passage: "p-cost" },
      { kind: "cited", passage: "p-cost" },
    ]);
  });

  it("送出的 <passages> 包含看不到的段落文字或文件標題（以跳脫後的文字比對）", () => {
    const obs = observe(refusal, { bodies: [body(passage("p-cost", "材料成本 8,500 元", "成本 <估算>"))] });
    expect(findLeaks(q, obs, ctx)).toEqual([
      { kind: "sentPassage", passage: "p-cost" },
      { kind: "sentDocument", document: "d-secret" },
    ]);
  });

  it("<question> 區段不檢查：題目本身是看不到的段落文字時不算滲漏", () => {
    const sent = body(passage("p-launch-zh", "預計第二季上市", "進度"));
    sent.messages[0].content = sent.messages[0].content.replace("成本 8,500 元是多少？", "材料成本 8,500 元");
    expect(sent.messages[0].content).toContain("材料成本 8,500 元");
    expect(passagesSection(sent)).not.toContain("材料成本");
    expect(findLeaks(q, observe(refusal, { bodies: [sent] }), ctx)).toEqual([]);
  });

  it("leakContext 以 oracle 計算角色看得到的段落與文件", () => {
    const staff = leakContext(clientConfig.access, dataset, "staff");
    expect(staff.visiblePassages.has("bluewing-kickoff-zh-01")).toBe(true);
    // 文件看得到、段落比文件機密
    expect(staff.visibleDocuments.has("bluewing-kickoff-zh")).toBe(true);
    expect(staff.visiblePassages.has("bluewing-kickoff-zh-03")).toBe(false);
    expect(staff.visibleDocuments.has("bluewing-cost-zh")).toBe(false);
    expect(staff.passages.length).toBe(Object.values(dataset.documents).flatMap((d) => d.passages).length);
  });
});

describe("指標彙總", () => {
  const answerQ = (id: string) => question({ id });
  const refusalQ = (id: string) => question({ id, expect: "refusal", keyPoints: [], referenceAnswer: null });
  const questions = [answerQ("a1"), answerQ("a2"), refusalQ("r1"), refusalQ("r2")];
  const good = answer("第二季、第三季", ["p-launch-zh"]);
  const scores = (): QuestionScore[] => [
    scoreQuestion(questions[0], observe(good), ctx),
    scoreQuestion(questions[1], observe(answer("第三季", ["p-cost"])), ctx),
    scoreQuestion(questions[2], observe(refusal), ctx),
    scoreQuestion(questions[3], observe(refusal), ctx),
  ];

  it("分母：引用與答案是預期回答的題目，拒答是預期拒答的題目，滲漏是全部題目", () => {
    const s = summarize(questions, scores(), EVAL_THRESHOLDS_DEFAULTS);
    expect(s).toMatchObject({ done: 4, total: 4, complete: true });
    expect(s.citation).toEqual({ passed: 1, total: 2, rate: 0.5, meets: false });
    expect(s.answer).toEqual({ passed: 1, total: 2, rate: 0.5, meets: false, ungradable: 0 });
    // a2 引用了看不到的段落
    expect(s.leakage).toEqual({ passed: 1, total: 4, rate: 0.25, meets: false });
    expect(s.refusal).toEqual({ passed: 2, total: 2, rate: 1, meets: true });
  });

  it("達到門檻才通過（比例的浮點誤差不影響，例如 9/10 對 0.9）", () => {
    const many = Array.from({ length: 10 }, (_, i) => answerQ(`a${i}`));
    const results = many.map((q, i) => scoreQuestion(q, observe(i === 0 ? answer("無") : good), ctx));
    const s = summarize(many, results, { ...EVAL_THRESHOLDS_DEFAULTS, citation: 0.9, answer: 0.9 });
    expect(s.citation).toMatchObject({ passed: 9, total: 10, meets: true });
    expect(s.answer).toMatchObject({ passed: 9, meets: true });
    expect(s.leakage).toMatchObject({ passed: 0, meets: true });
    expect(s.refusal).toEqual({ passed: 0, total: 0, rate: null, meets: null });
  });

  it("權限滲漏的上限固定是 0：有一題滲漏就未通過，與可設定的門檻無關", () => {
    expect(LEAKAGE_LIMIT).toBe(0);
    const s = summarize(questions, scores(), { citation: 0, answer: 0, refusal: 0 });
    expect(s.leakage).toMatchObject({ passed: 1, meets: false });
    const clean = scores().filter((sc) => sc.leaks.length === 0);
    const cleanQuestions = questions.filter((q) => clean.some((sc) => sc.id === q.id));
    expect(summarize(cleanQuestions, clean, EVAL_THRESHOLDS_DEFAULTS).leakage).toMatchObject({ passed: 0, meets: true });
  });

  it("沒跑完時只算已完成的題目，不判定通過或未通過", () => {
    const s = summarize(questions, scores().slice(0, 3), EVAL_THRESHOLDS_DEFAULTS);
    expect(s).toMatchObject({ done: 3, total: 4, complete: false });
    expect(s.refusal).toEqual({ passed: 1, total: 1, rate: 1, meets: null });
    expect([s.citation.meets, s.answer.meets, s.leakage.meets]).toEqual([null, null, null]);
  });

  it("模型評分：correct 才算正確，無法評分另外計數；關鍵重點的結果保留", () => {
    const grades = new Map<string, ModelGrade>([
      ["a1", { verdict: "ungradable", reason: null }],
      ["a2", { verdict: "correct", reason: "ok" }],
    ]);
    const results = scores();
    const s = summarize(questions, results, EVAL_THRESHOLDS_DEFAULTS, "model", grades);
    expect(s.answer).toMatchObject({ passed: 1, total: 2, ungradable: 1 });
    expect(results[0].keyPoints?.pass).toBe(true);
    expect(results[1].keyPoints?.pass).toBe(false);
    // 沒有評分結果也算無法評分
    expect(summarize(questions, results, EVAL_THRESHOLDS_DEFAULTS, "model").answer).toMatchObject({ passed: 0, ungradable: 2 });
  });

  it("模型評分時，拒答或錯誤不算正確，也不算無法評分", () => {
    const results = [scoreQuestion(questions[0], observe(refusal), ctx), scoreQuestion(questions[1], observe(error), ctx)];
    const grades = new Map<string, ModelGrade>([["a1", { verdict: "correct", reason: null }]]);
    expect(summarize(questions.slice(0, 2), results, EVAL_THRESHOLDS_DEFAULTS, "model", grades).answer).toMatchObject({ passed: 0, ungradable: 0 });
  });
});
