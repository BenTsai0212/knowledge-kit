// 說法不同的提問（ADR 0012 決定 3、4，畫板 S-QA 的 ③）：提問時只有假設（或固定範本）、「都不是，我來說明」與「略過」，
// 證據不在提問時出現（避免錨定）；另一種讀法用 markSoft 底，不用 danger、warning
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill, strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import type { ConflictItem, ConflictPassage } from "../conflicts/store";
import css from "./app.css?raw";
import { SeamDialogue } from "./SeamDialogue";

const language = clientConfig.client.defaultLanguage;
const s = strings(language);
const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

const passage = (id: string, title: string, date: string | null, content: string): ConflictPassage => ({
  id,
  documentId: `d-${id}`,
  documentTitle: title,
  visibility: "internal",
  project: null,
  date,
  language,
  content,
});

const item = (extra: Partial<ConflictItem> = {}): ConflictItem => ({
  id: "pc-1",
  documentId: "d-new",
  summary: "時程不同",
  newPassage: passage("new", "進度更新", "2026-05-15", "上市時間延後至 Q3。"),
  oldPassage: passage("old", "啟動會議紀錄", "2026-02-10", "預計 Q2 上市。"),
  hypotheses: ["我覺得是後來改過", "我覺得是不同的版本"],
  evidence: { text: "延後至 Q3", supports: 1 },
  decision: "coexist",
  ...extra,
});

let n = 0;
const render = (seam: ConflictItem) =>
  renderToStaticMarkup(createElement(SeamDialogue, { id: `t-${n++}`, language, seam, onOpenSource: () => {}, record: async () => {}, skip: () => {} }));

describe("說法不同的提問", () => {
  it("有假設時：固定的提問、假設、都不是與略過；不顯示證據", () => {
    const html = render(item());
    expect(html).toContain(escape(s.dialogueConflictAsk));
    for (const label of ["我覺得是後來改過", "我覺得是不同的版本", s.commonExplain, s.dialogueSkip]) expect(html).toContain(`>${escape(label)}</button>`);
    expect(html).toContain(escape(s.commonYourTurn));
    expect(html).not.toContain("延後至 Q3");
    expect(html).not.toContain("seam-alt");
  });

  it("沒有假設或證據時：固定範本寫出較新、較舊的文件與相差的月數，三個固定選項", () => {
    const html = render(item({ hypotheses: null, evidence: null }));
    expect(html).toContain(escape(fill(s.dialogueConflictTemplate, { newer: "進度更新", older: "啟動會議紀錄", months: 3 }, language)));
    for (const label of [s.dialogueChoiceChanged, s.dialogueChoiceDifferent, s.dialogueChoiceWrong]) expect(html).toContain(`>${escape(label)}</button>`);
  });

  it("日期相同或沒有日期時不寫月數", () => {
    const noMonths = fill(s.dialogueConflictTemplate, { newer: "進度更新", older: "啟動會議紀錄", months: 0 }, language);
    expect(noMonths).not.toContain("{");
    expect(noMonths).not.toBe(fill(s.dialogueConflictTemplate, { newer: "進度更新", older: "啟動會議紀錄", months: 3 }, language));
    expect(render(item({ hypotheses: null, evidence: null, oldPassage: passage("old", "啟動會議紀錄", null, "預計 Q2 上市。") }))).toContain(escape(noMonths));
  });
});

describe("另一種讀法的外觀", () => {
  it("markSoft 底、mark 系的細邊；不用 danger、warning", () => {
    const block = cssText.match(/\n\.seam-alt\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toContain("background: var(--color-markSoft)");
    expect(block).toContain("var(--color-mark)");
    const rules = cssText.match(/\.seam-[\w-]+[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(/--color-(danger|warning)/);
  });
});
