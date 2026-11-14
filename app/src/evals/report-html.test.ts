// 品質報告的 HTML（#210）：自成一頁、不依賴外部資源、第一頁與附錄的內容，以及機密（不含段落文字、forbidden、回答與題目 id）。
// 以參考情境的題庫與資料集組成假的評測結果，不呼叫 API。
import { describe, expect, it } from "vitest";
import { fill, strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import type { LanguageCode } from "../client/types";
import { dataset } from "../dataset/load";
import { evalQuestions } from "./load";
import { qualityReport, restrictedRoles, type ReportSource } from "./report";
import { appendixPages, escapeHtml, PAGE_ROWS, reportHtml } from "./report-html";
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

const CLIENT = client.displayName[language];
const html = (current: ReportSource, previous: ReportSource | null = null, lang: LanguageCode = language) =>
  reportHtml(qualityReport({ questions, access, data: dataset, thresholds, current, set: 0, previous }), access, lang, client.displayName[lang] ?? CLIENT);
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
    expect(page).not.toContain(`<th>${escapeHtml(t.second)}</th>`);
  });

  it("未達門檻與兩次比較：標題寫出未達的指標，第二次的欄位與結果不同的題數", () => {
    const page = html(source(allFail()), source(allPass()));
    expect(page).not.toContain(escapeHtml(t.headlineMet));
    expect(page).toContain(`<th>${escapeHtml(t.second)}</th>`);
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

// 版面（#281，docs/design.md「品質報告的列印版面」）；列印成 PDF 的實際版面由人工確認（中文與英文各一次）
describe("reportHtml：列印版面", () => {
  const styleOf = (page: string) => page.slice(page.indexOf("<style>"), page.indexOf("</style>"));
  const firstOf = (page: string) => page.slice(page.indexOf('<section class="page first"'), page.indexOf('<section class="page appendix"'));
  const appendixOf = (page: string) => page.slice(page.indexOf('<section class="page appendix"'));
  const pagesOf = (page: string) => page.split('<section class="page ').slice(1);
  const count = (text: string, part: string) => text.split(part).length - 1;
  const s = strings(language);

  it("A4 直式；每頁一個 section，頁尾是「客戶 · 品質報告」與「第 N／M 頁」（#347）", () => {
    for (const lang of client.languages) {
      const r = strings(lang).evalReport;
      const name = client.displayName[lang] ?? CLIENT;
      const page = html(source(allPass()), null, lang);
      expect(styleOf(page)).toContain("size: A4 portrait;");
      const pages = pagesOf(page);
      expect(pages.length).toBeGreaterThanOrEqual(2);
      pages.forEach((p, i) => {
        const label = escapeHtml(fill(r.page, { page: i + 1, pages: pages.length }, lang));
        expect(p).toContain(`aria-label="${label}"`);
        expect(p).toContain(`<footer class="page-foot"><span>${escapeHtml(fill(r.footerTitle, { client: name }, lang))}</span><span>${label}</span></footer>`);
      });
    }
    expect(styleOf(html(source(allPass())))).toContain(".page { margin: 0; box-shadow: none; min-height: 296mm; break-after: page; }");
  });

  it("未通過的題目全部列出：放不下時延續到下一頁，測試條件在最後一頁", () => {
    const pages = pagesOf(html(source(allFail())));
    const restricted = restrictedRoles(access);
    const failures = questions.filter((q) => !restricted.has(q.role)).length;
    expect(failures).toBeGreaterThan(PAGE_ROWS);
    expect(pages.length).toBeGreaterThan(2);
    const rows = pages.map((p) => [...p.matchAll(/<tr><td>(\d+)<\/td>/g)].length);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(failures);
    expect(rows[0]).toBe(0);
    // 身分 × 類別只在第 2 頁，測試條件只在最後一頁
    expect(pages.filter((p) => p.includes(escapeHtml(t.matrixTitle)))).toEqual([pages[1]]);
    expect(pages.filter((p) => p.includes(escapeHtml(t.conditionsTitle)))).toEqual([pages.at(-1)]);
  });

  it("appendixPages：題目少時附錄一頁；多時依序分頁、不漏不重複", () => {
    expect(appendixPages(0, 3)).toEqual([{ from: 0, to: 0, matrix: true, conditions: true }]);
    expect(appendixPages(3, 3)).toEqual([{ from: 0, to: 3, matrix: true, conditions: true }]);
    for (const n of [5, 20, 41, 100]) {
      const pages = appendixPages(n, 3);
      expect(pages.filter((p) => p.matrix)).toEqual([pages[0]]);
      expect(pages.filter((p) => p.conditions)).toEqual([pages.at(-1)]);
      pages.forEach((p, i) => {
        expect(p.from).toBe(i === 0 ? 0 : pages[i - 1].to);
        expect(p.to - p.from).toBeLessThanOrEqual(PAGE_ROWS);
      });
      expect(pages.at(-1)!.to).toBe(n);
    }
  });

  it("不寫死顏色：沒有色碼、rgb()、hsl() 與顏色名稱；字型是系統字型", () => {
    const style = styleOf(html(source(allFail()), source(allPass())));
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|(?<![\w-])(black|white|gr[ae]y|red|green|blue|orange|yellow)(?![\w-])/i);
    expect(style).toContain("currentColor");
    expect(style).toContain("font-family: system-ui");
    expect(style).not.toContain("@font-face");
  });

  it("第一頁：頁首（產品名、客戶、評測日期、題庫版本）、結論標題、四項指標、各身分、不代表什麼；附錄從新的一頁開始", () => {
    const page = html(source(allPass()));
    const first = firstOf(page);
    const masthead = first.slice(first.indexOf('<header class="masthead">'), first.indexOf("</header>"));
    for (const x of [s.productName, CLIENT, "2026-11-10", "0123456789ab"]) expect(masthead).toContain(escapeHtml(x));
    expect(first.indexOf("</header>")).toBeLessThan(first.indexOf("<h1>"));
    expect(masthead).toContain("<svg");
    // 各身分一張卡片：「身分 · N 題」與「✓ 滲漏 0 題」
    expect(count(first, "<li><span>")).toBe(new Set(questions.map((q) => q.role)).size);
    expect(first).toContain(escapeHtml(`${t.passMark} ${fill(t.roleLeaked, { leaked: 0 }, language)}`));
    expect(count(first, '<div class="bar"')).toBe(4);
    expect(first.match(/<span class="limit" style="left: [\d.]+%"><\/span>/g)).toHaveLength(4);
    expect(first).toContain(escapeHtml(t.thresholdLegend));
    expect(first).toContain(escapeHtml(t.leakExplain));
    expect(first).toContain(escapeHtml(t.limitsTitle));
    // 附錄的內容不在第一頁
    expect(first).not.toContain(escapeHtml(t.matrixTitle));
    expect(page).toContain(".appendix { break-before: page; }");
  });

  it("條狀圖的長度是結果、虛線在門檻的位置", () => {
    const page = html(source(allPass()));
    const citation = page.slice(page.indexOf(`<th scope="row">${escapeHtml(s.evalMetrics.citation)}</th>`));
    const limit = Math.round(thresholds.citation * 1000) / 10;
    expect(citation.slice(0, citation.indexOf("</tr>"))).toContain(`<span class="fill" style="width: 100%"></span><span class="limit" style="left: ${limit}%"></span>`);
  });

  it("通過與否用 ✓／✕ 與文字：全部達到時每列「✓ 達到」，沒有加粗門檻線的列", () => {
    const first = firstOf(html(source(allPass())));
    expect(count(first, escapeHtml(`${t.passMark} ${t.metLabel}`))).toBe(4);
    expect(first).not.toContain('class="unmet"');
    expect(first).not.toContain(escapeHtml(`${t.failMark} ${t.unmetLabel}`));
  });

  it("未達時只加粗門檻線（.unmet）、該列標「✕ 未達」；第二次的結果與「✓ 兩次」", () => {
    const page = html(source(allFail()), source(allPass()));
    const failing = firstOf(page);
    const unmetRows = count(failing, '<tr class="unmet">');
    expect(unmetRows).toBeGreaterThan(0);
    expect(count(failing, escapeHtml(`${t.failMark} ${t.unmetLabel}`))).toBe(unmetRows);
    expect(styleOf(page)).toContain(".unmet .bar .limit { border-left-width: 3px; }");

    const both = firstOf(html(source(allPass()), source(allPass())));
    expect(both).toContain(escapeHtml(t.second));
    expect(count(both, escapeHtml(`${t.passMark} ${t.bothLabel}`))).toBe(4);
  });

  it("各身分以 ✓／✕ 標出滲漏；附錄以 ✕ 標出有未通過的格", () => {
    const pass = html(source(allPass()));
    expect(firstOf(pass)).toContain(`<strong>${escapeHtml(t.passMark)} `);
    expect(appendixOf(pass)).not.toContain(escapeHtml(t.failMark));
    const fail = html(source(allFail()));
    expect(firstOf(fail)).toContain(`<strong>${escapeHtml(t.failMark)} `);
    expect(appendixOf(fail)).toContain(`<td class="miss">${escapeHtml(t.failMark)} `);
  });

  it("可填寫的欄位：螢幕上是虛線框，列印時變成底線；上方的說明條列印時隱藏", () => {
    const page = html(source(allFail()));
    expect(page).toContain(`<div class="field" contenteditable="true" role="textbox" aria-label="${escapeHtml(t.reason)}"></div>`);
    expect(page).toContain(`aria-label="${escapeHtml(t.action)}"`);
    const style = styleOf(page);
    expect(style).toMatch(/\n\.field \{[^}]*border: 1px dashed /);
    const print = style.slice(style.indexOf("@media print"));
    expect(print).toContain(".field { border: 0; border-bottom: 1px solid; border-radius: 0; }");
    expect(print).toContain(".note { display: none; }");
  });

  it("英文介面：指標表固定欄寬（名稱允許換行），內容同樣完整", () => {
    const en = strings("en");
    const page = html(source(allFail()), source(allPass()), "en");
    expect(page).toContain('<html lang="en">');
    expect(page).toContain('<table class="metrics"><colgroup><col class="name">');
    expect(styleOf(page)).toContain(".metrics { table-layout: fixed; }");
    for (const key of ["citation", "answer", "leakage", "refusal"] as const) expect(page).toContain(escapeHtml(en.evalMetrics[key]));
    expect(page).toContain(escapeHtml(en.evalReport.evaluatedOn));
  });
});
