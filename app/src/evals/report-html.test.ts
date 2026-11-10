// 品質報告的 HTML（#210）：自成一頁、不依賴外部資源、第一頁與附錄的內容，以及機密（不含段落文字、forbidden、回答與題目 id）。
// 以參考情境的題庫與資料集組成假的評測結果，不呼叫 API。
import { describe, expect, it } from "vitest";
import { strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import { evalQuestions } from "./load";
import { qualityReport, restrictedRoles, type ReportSource } from "./report";
import { escapeHtml, reportHtml } from "./report-html";
import type { QuestionResult } from "./run";
import { summarize, type QuestionScore } from "./score";
import type { EvalQuestion } from "./types";

const { access, client } = clientConfig;
const { thresholds } = client.evals;
const questions = evalQuestions.questions;
const language = client.defaultLanguage;
const t = strings(language).evalReport;
const ANSWER_TEXT = "Answer body that must never reach the report";

// fail 為 true 時這題在答案（或拒答）與權限滲漏都失敗
function resultFor(q: EvalQuestion, fail = false): QuestionResult {
  const answers = q.expect === "answer";
  const score: QuestionScore = {
    id: q.id,
    outcome: answers || fail ? "answer" : "refusal",
    error: null,
    citation: answers ? { pass: true, cited: [], dropped: [] } : null,
    keyPoints: answers ? { pass: !fail, points: q.keyPoints.map((synonyms) => ({ synonyms, matched: synonyms[0] })) } : null,
    refused: answers ? null : !fail,
    leaks: fail ? [{ kind: "forbidden", term: q.forbidden[0]?.[0] ?? "x" }, { kind: "retrieved", passage: "p" }] : [],
  };
  const answer = { kind: "answer" as const, text: ANSWER_TEXT, numbering: [], cited: [], dropped: [], uncited: false, incomplete: false };
  return { question: q.id, answer, score, calls: 1 };
}

function source(results: QuestionResult[], patch: Partial<ReportSource> = {}): ReportSource {
  return {
    mode: "keyPoints",
    provider: "keyword-hash",
    model: client.model,
    questionBank: { hash: "0123456789ab", questions: questions.length },
    notApplicable: [],
    status: "done",
    startedAt: "2026-11-10T01:02:03.000Z",
    finishedAt: "2026-11-10T01:12:03.000Z",
    sets: [{ settings: { topK: 5, minScore: 0.1 }, summary: summarize(questions, results.map((r) => r.score), thresholds, "keyPoints"), results }],
    ...patch,
  };
}

const html = (current: ReportSource, previous: ReportSource | null = null) =>
  reportHtml(qualityReport({ questions, access, data: dataset, thresholds, current, set: 0, previous }), access, language);
const allPass = () => questions.map((q) => resultFor(q));
const allFail = () => questions.map((q) => resultFor(q, true));

describe("reportHtml：自成一頁", () => {
  it("不依賴外部資源：沒有 script、link、圖片、外部網址與 @import", () => {
    for (const page of [html(source(allPass())), html(source(allFail()), source(allPass()))]) {
      expect(page.startsWith("<!doctype html>")).toBe(true);
      expect(page).toContain('<meta charset="utf-8">');
      expect(page).toContain("<style>");
      expect(page).not.toMatch(/<script|<link|<img|<iframe|src=|href=|https?:|url\(|@import/i);
    }
  });

  it("列印時附錄從新的一頁開始；上方說明可編輯欄位不會自動保存（列印時隱藏）", () => {
    const page = html(source(allFail()));
    expect(page).toContain("@media print");
    expect(page).toContain(".appendix { break-before: page; }");
    expect(page).toContain(escapeHtml(t.editNote));
    expect(page.match(/contenteditable="true"/g)?.length).toBeGreaterThan(0);
  });

  it("escapeHtml 跳脫 HTML 的特殊字元", () => {
    expect(escapeHtml(`<b a="1">'&'</b>`)).toBe("&#60;b a=&#34;1&#34;&#62;&#39;&#38;&#39;&#60;/b&#62;");
  });
});

describe("reportHtml：第一頁與附錄", () => {
  it("全部通過：結論標題、四個指標、每種身分、不代表什麼、測試條件", () => {
    const page = html(source(allPass()));
    const s = strings(language);
    expect(page).toContain(escapeHtml(t.headlineMet));
    for (const key of ["citation", "answer", "leakage", "refusal"] as const) expect(page).toContain(escapeHtml(s.evalMetrics[key]));
    expect(page).toContain(escapeHtml(t.limitsTitle));
    expect(page).toContain(escapeHtml(t.leakExplain));
    expect(page).toContain(escapeHtml(t.noFailures));
    expect(page).toContain("0123456789ab");
    expect(page).toContain("2026-11-10 01:02 UTC");
    for (const role of new Set(questions.map((q) => q.role))) {
      expect(page).toContain(escapeHtml(access.roles.find((r) => r.id === role)!.label[language]));
    }
    // 兩次比較的欄位只在有第二份時出現
    expect(page).not.toContain(escapeHtml(t.bothMeet));
  });

  it("未達門檻與兩次比較：標題寫出未達的指標，第二次的欄位與結果不同的題數", () => {
    const page = html(source(allFail()), source(allPass()));
    expect(page).not.toContain(escapeHtml(t.headlineMet));
    expect(page).toContain(escapeHtml(t.bothMeet));
    expect(page).toContain(escapeHtml(t.stabilityTitle));
    expect(page).toContain(escapeHtml(t.reason));
  });

  it("題庫版本不同、舊格式（沒有題庫版本與呼叫次數）時註明", () => {
    const page = html(source(allPass()), source(allPass(), { questionBank: { hash: "ffffffffffff", questions: 1 } }));
    expect(page).toContain(escapeHtml(t.noteBankDiffers));
    const legacy = allPass().map(({ calls: _calls, ...rest }) => rest);
    const old = html(source(legacy, { questionBank: undefined, model: undefined }), source(allPass()));
    expect(old).toContain(escapeHtml(t.noteBankUnknown));
    expect(old).not.toContain("0123456789ab");
  });

  it("沒有跑完時不判定", () => {
    const page = html(source(allPass().slice(0, 5), { status: "stopped", finishedAt: null }));
    expect(page).toContain(escapeHtml(t.headlineIncomplete));
    expect(page).not.toContain(escapeHtml(t.headlineMet));
  });
});

describe("reportHtml：機密（#210 決定 3 與補充）", () => {
  const page = html(source(allFail()), source(allFail()));
  const restricted = restrictedRoles(access);

  it("不含回答、題目文字、段落文字、keyPoints、forbidden 與 referenceAnswer", () => {
    const passages = Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => p.text));
    const secrets = [
      ANSWER_TEXT,
      ...questions.map((q) => q.question),
      ...questions.flatMap((q) => [...q.keyPoints.flat(), ...q.forbidden.flat(), q.referenceAnswer ?? ""]),
      ...passages,
    ].filter((x) => x.length >= 4);
    expect(secrets.length).toBeGreaterThan(100);
    expect(secrets.filter((x) => page.includes(x) || page.includes(escapeHtml(x)))).toEqual([]);
  });

  it("不含任何題目 id 與段落 id；最高可見等級的身分只呈現彙總", () => {
    const ids = [...questions.map((q) => q.id), ...Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => p.id))];
    expect(ids.filter((id) => page.includes(id))).toEqual([]);
    expect(restricted.size).toBeGreaterThan(0);
    expect(page).toContain(escapeHtml(t.restrictedNote.slice(t.restrictedNote.indexOf("}") + 1, t.restrictedNote.indexOf("{", 1))));
    // 未通過題目的序號：最高可見等級的身分不列出
    const numbers = [...page.matchAll(/<tr><td>(\d+)<\/td>/g)].map((m) => Number(m[1]));
    const expected = questions.flatMap((q, i) => (restricted.has(q.role) ? [] : [i + 1]));
    expect(numbers).toEqual(expected);
  });
});
