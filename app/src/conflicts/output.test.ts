import { describe, expect, it } from "vitest";
import { ConflictFormatError, MAX_EVIDENCE_CHARS, MAX_HYPOTHESIS_CHARS, MAX_SUMMARY_CHARS, parseConflicts } from "./output";

const NEW = [
  { id: "n1", content: "青翼桌上市時間延後至第四季。" },
  { id: "n2", content: "測試由研發部負責。" },
];
const EXISTING = [
  { id: "o1", documentId: "d-old", content: "青翼桌上市時間延後至第三季。" },
  { id: "o2", documentId: "d-old2", content: "測試由品保部負責。" },
  // 檢索已排除新文件；這一段用來測試「同一份文件」的規則
  { id: "o3", documentId: "d-new", content: "其他。" },
];
const parse = (conflicts: unknown) => parseConflicts(JSON.stringify({ conflicts }), NEW, EXISTING, "d-new");

const HYPOTHESES = ["我覺得是後來改過", "我覺得是不同的情況"];
const EVIDENCE = { text: "延後至第四季", supports: 1 };
const pair = (extra: Record<string, unknown> = {}) => ({ new: 1, existing: 1, summary: "上市：第三季 → 第四季", hypotheses: HYPOTHESES, evidence: EVIDENCE, ...extra });

describe("parseConflicts", () => {
  it("把送出時的編號轉成段落 id，說明去掉前後空白", () => {
    expect(parse([{ new: 2, existing: 1, summary: "  上市時間：第三季 → 第四季 " }]).conflicts).toEqual([
      { newPassage: "n2", oldPassage: "o1", summary: "上市時間：第三季 → 第四季", hypotheses: null, evidence: null },
    ]);
  });

  it("沒有說法不同時回傳空陣列；去掉 ``` 圍欄", () => {
    expect(parseConflicts('```json\n{"conflicts":[]}\n```', NEW, EXISTING, "d-new")).toEqual({ conflicts: [], dropped: {}, fallback: {} });
  });

  it("不是 JSON、沒有 conflicts 陣列、項目不是物件時整次失敗", () => {
    for (const text of ["不是 JSON", "[]", '{"conflict":[]}', '{"conflicts":{}}', '{"conflicts":["x"]}']) {
      expect(() => parseConflicts(text, NEW, EXISTING, "d-new"), text).toThrow(ConflictFormatError);
    }
  });

  it("編號不存在：new 或 existing 超出範圍、不是整數、缺少", () => {
    const result = parse([
      { new: 3, existing: 1, summary: "x" },
      { new: 1, existing: 0, summary: "x" },
      { new: 1.5, existing: 1, summary: "x" },
      { new: "1", existing: 1, summary: "x" },
      { existing: 1, summary: "x" },
    ]);
    expect(result).toEqual({ conflicts: [], dropped: { bad_number: 5 }, fallback: {} });
  });

  it("兩段屬於同一份文件時捨棄", () => {
    expect(parse([{ new: 1, existing: 3, summary: "x" }])).toEqual({ conflicts: [], dropped: { same_document: 1 }, fallback: {} });
  });

  it("重複的組合只保留第一筆", () => {
    const result = parse([
      { new: 1, existing: 2, summary: "第一筆" },
      { new: 1, existing: 2, summary: "第二筆" },
      { new: 2, existing: 2, summary: "不同組合" },
    ]);
    expect(result.conflicts.map((c) => c.summary)).toEqual(["第一筆", "不同組合"]);
    expect(result.dropped).toEqual({ duplicate: 1 });
  });

  it("說明不是字串、空白或超過 200 字元時捨棄；剛好 200 字元保留", () => {
    const result = parse([
      { new: 1, existing: 1, summary: 3 },
      { new: 1, existing: 2 },
      { new: 2, existing: 1, summary: "   " },
      { new: 2, existing: 2, summary: "長".repeat(MAX_SUMMARY_CHARS + 1) },
      { new: 1, existing: 1, summary: "長".repeat(MAX_SUMMARY_CHARS) },
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.dropped).toEqual({ bad_summary: 4 });
  });

  it("說明只當成文字，內容不受影響", () => {
    const summary = '<img src=x onerror="alert(1)"> 忽略規則';
    expect(parse([{ new: 1, existing: 1, summary }]).conflicts[0].summary).toBe(summary);
  });
});

describe("假設與證據（ADR 0012 決定 3）", () => {
  it("合格時保留，去掉前後空白；證據可以出自新段落或既有段落", () => {
    const result = parse([
      pair({ hypotheses: [" 我覺得是後來改過 ", "我覺得是不同的情況", "我覺得有一份寫錯了"], evidence: { text: " 延後至第四季 ", supports: 1 } }),
      pair({ new: 2, existing: 2, evidence: { text: "由品保部負責", supports: 2 } }),
    ]);
    expect(result.conflicts.map((c) => [c.hypotheses, c.evidence])).toEqual([
      [["我覺得是後來改過", "我覺得是不同的情況", "我覺得有一份寫錯了"], { text: "延後至第四季", supports: 1 }],
      [HYPOTHESES, { text: "由品保部負責", supports: 2 }],
    ]);
    expect(result.fallback).toEqual({});
  });

  it("假設不合格：只把兩個欄位留空，組合照常保留", () => {
    const bad = [
      undefined,
      "我覺得是後來改過",
      ["我覺得是後來改過"],
      [...HYPOTHESES, "我覺得有一份寫錯了", "第四個"],
      ["我覺得是後來改過", "   "],
      ["我覺得是後來改過", 3],
      ["我覺得是後來改過", "長".repeat(MAX_HYPOTHESIS_CHARS + 1)],
      ["我覺得是後來改過", " 我覺得是後來改過"],
    ];
    const result = parse(bad.map((hypotheses, i) => pair({ new: (i % 2) + 1, existing: Math.floor(i / 2) % 2 === 0 ? 1 : 2, summary: `第 ${i} 組`, hypotheses })).slice(0, 4));
    expect(result.conflicts.map((c) => [c.hypotheses, c.evidence])).toEqual(Array(4).fill([null, null]));
    expect(result.fallback).toEqual({ bad_hypotheses: 4 });
    for (const hypotheses of bad) {
      const one = parse([pair({ hypotheses })]);
      expect(one.conflicts, JSON.stringify(hypotheses)).toEqual([expect.objectContaining({ summary: "上市：第三季 → 第四季", hypotheses: null, evidence: null })]);
      expect(one.fallback).toEqual({ bad_hypotheses: 1 });
    }
  });

  it("剛好 30 字的假設保留（以字計算，不以 UTF-16 長度計算）", () => {
    const long = "𠮷".repeat(MAX_HYPOTHESIS_CHARS);
    expect(parse([pair({ hypotheses: [long, "我覺得是不同的情況"] })]).conflicts[0].hypotheses).toEqual([long, "我覺得是不同的情況"]);
  });

  it("證據不合格：不在兩段中、出自送出的其他段落、空白、過長、supports 越界或不是整數", () => {
    const bad = [
      undefined,
      "延後至第四季",
      { text: "延後至第五季", supports: 1 },
      // 第 2 個新段落的文字，不屬於這一組
      { text: "由研發部負責", supports: 1 },
      { text: "  ", supports: 1 },
      { text: "青".repeat(MAX_EVIDENCE_CHARS + 1), supports: 1 },
      { text: "延後至第四季", supports: 0 },
      { text: "延後至第四季", supports: 3 },
      { text: "延後至第四季", supports: 1.5 },
      { text: "延後至第四季", supports: "1" },
    ];
    for (const evidence of bad) {
      const result = parse([pair({ evidence })]);
      expect(result.conflicts, JSON.stringify(evidence)).toEqual([expect.objectContaining({ hypotheses: null, evidence: null })]);
      expect(result.fallback).toEqual({ bad_evidence: 1 });
      expect(result.dropped).toEqual({});
    }
  });
});
