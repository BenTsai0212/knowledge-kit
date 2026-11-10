import { describe, expect, it } from "vitest";
import { ConflictFormatError, MAX_SUMMARY_CHARS, parseConflicts } from "./output";

const NEW = ["n1", "n2"];
const EXISTING = [
  { id: "o1", documentId: "d-old" },
  { id: "o2", documentId: "d-old2" },
  // 檢索已排除新文件；這一段用來測試「同一份文件」的規則
  { id: "o3", documentId: "d-new" },
];
const parse = (conflicts: unknown) => parseConflicts(JSON.stringify({ conflicts }), NEW, EXISTING, "d-new");

describe("parseConflicts", () => {
  it("把送出時的編號轉成段落 id，說明去掉前後空白", () => {
    expect(parse([{ new: 2, existing: 1, summary: "  上市時間：第三季 → 第四季 " }])).toEqual({
      conflicts: [{ newPassage: "n2", oldPassage: "o1", summary: "上市時間：第三季 → 第四季" }],
      dropped: {},
    });
  });

  it("沒有說法不同時回傳空陣列；去掉 ``` 圍欄", () => {
    expect(parseConflicts('```json\n{"conflicts":[]}\n```', NEW, EXISTING, "d-new")).toEqual({ conflicts: [], dropped: {} });
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
    expect(result).toEqual({ conflicts: [], dropped: { bad_number: 5 } });
  });

  it("兩段屬於同一份文件時捨棄", () => {
    expect(parse([{ new: 1, existing: 3, summary: "x" }])).toEqual({ conflicts: [], dropped: { same_document: 1 } });
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
