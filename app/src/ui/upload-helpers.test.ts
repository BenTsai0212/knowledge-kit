import { describe, expect, it } from "vitest";
import { flyPath, foundTerms, sentForReview, underlineRanges, uploadSteps, passagesWordCount, type UploadProgress } from "./upload-helpers";

// 頁首的五個步驟與檔案卡片的字數（#242）
const idle: UploadProgress = { hasInput: false, parsing: false, passages: null, written: false, batches: null };
const batch = (status: string, entities = 0, relations = 0) => ({ status, entities, relations });
const statuses = (p: UploadProgress) => uploadSteps(p).map((step) => step.status);

describe("uploadSteps()", () => {
  it("五個步驟依序是上傳、切段、模型萃取、人工審核、併入圖譜", () => {
    expect(uploadSteps(idle).map((step) => step.name)).toEqual(["upload", "chunk", "extract", "review", "merge"]);
  });

  it("還沒選檔：上傳進行中，其他未開始", () => {
    expect(statuses(idle)).toEqual(["active", "todo", "todo", "todo", "todo"]);
  });

  it("選檔後與讀取中：切段進行中", () => {
    expect(statuses({ ...idle, hasInput: true })).toEqual(["done", "active", "todo", "todo", "todo"]);
    expect(statuses({ ...idle, hasInput: true, parsing: true })).toEqual(["done", "active", "todo", "todo", "todo"]);
  });

  it("預覽後：切段完成並顯示段落數，萃取等寫入後才開始", () => {
    const steps = uploadSteps({ ...idle, hasInput: true, passages: 7 });
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "todo", "todo", "todo"]);
    expect(steps[1].detail).toEqual({ kind: "passages", count: 7 });
  });

  it("萃取中：顯示真實的批次（第 2 批執行中是 2／3）", () => {
    const steps = uploadSteps({ ...idle, hasInput: true, passages: 7, written: true, batches: [batch("done", 2, 1), batch("running"), batch("waiting")] });
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "active", "todo", "todo"]);
    expect(steps[2].detail).toEqual({ kind: "batch", done: 2, total: 3 });
  });

  it("寫入後、萃取狀態還沒出現：萃取進行中，不顯示批次", () => {
    const steps = uploadSteps({ ...idle, hasInput: true, passages: 7, written: true });
    expect(steps[2]).toEqual({ name: "extract", status: "active" });
  });

  it("有批次失敗：萃取停在進行中，批次是已完成的數量", () => {
    const steps = uploadSteps({ ...idle, hasInput: true, passages: 7, written: true, batches: [batch("done", 1), batch("failed"), batch("waiting")] });
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "active", "todo", "todo"]);
    expect(steps[2].detail).toEqual({ kind: "batch", done: 1, total: 3 });
  });

  it("萃取完成：人工審核進行中並顯示送審筆數，併入圖譜保持未完成（#242 決定 3）", () => {
    const steps = uploadSteps({ ...idle, hasInput: true, passages: 7, written: true, batches: [batch("done", 2, 1), batch("done", 3, 0)] });
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "done", "active", "todo"]);
    expect(steps[2].detail).toEqual({ kind: "batch", done: 2, total: 2 });
    expect(steps[3].detail).toEqual({ kind: "sent", count: 6 });
  });
});

describe("passagesWordCount()", () => {
  it("漢字與假名每字算 1，英文以單字計算", () => {
    expect(passagesWordCount(["示範公司的年度計畫"])).toBe(9);
    expect(passagesWordCount(["The annual plan, version 2."])).toBe(5);
    expect(passagesWordCount(["カタカナとひらがな"])).toBe(9);
  });

  it("中英混合與多段相加；空白與標點不算", () => {
    expect(passagesWordCount(["示範 Demo 計畫。", "  ", "—— 2026"])).toBe(6);
    expect(passagesWordCount([])).toBe(0);
  });
});

describe("foundTerms（#242）", () => {
  it("只取完成的批次；批次內依序編號；同一個名稱只取最早的批次", () => {
    const terms = foundTerms([
      { status: "done", found: [{ type: "person", names: ["甲", "乙"] }, { type: "project", names: ["青翼"] }] },
      { status: "failed", found: [{ type: "person", names: ["丙"] }] },
      { status: "done", found: [{ type: "person", names: ["甲", "丁"] }] },
    ]);
    expect(terms).toEqual([
      { name: "甲", type: "person", order: 0 },
      { name: "乙", type: "person", order: 1 },
      { name: "青翼", type: "project", order: 2 },
      { name: "丁", type: "person", order: 0 },
    ]);
  });
});

describe("underlineRanges（#242）", () => {
  const term = (name: string, type = "person", order = 0) => ({ name, type, order });

  it("標出每一處，依位置排序", () => {
    expect(underlineRanges("甲找乙，乙找甲", [term("甲"), term("乙", "person", 1)]).map((r) => [r.start, r.end, r.name])).toEqual([
      [0, 1, "甲"],
      [2, 3, "乙"],
      [4, 5, "乙"],
      [6, 7, "甲"],
    ]);
  });

  it("較長的名稱優先，範圍不重疊", () => {
    const ranges = underlineRanges("青翼專案由青翼負責", [term("青翼", "org"), term("青翼專案", "project", 1)]);
    expect(ranges.map((r) => [r.start, r.end, r.type])).toEqual([
      [0, 4, "project"],
      [5, 7, "org"],
    ]);
  });

  it("英文不分大小寫；沒有出現的名稱與空名稱略過", () => {
    expect(underlineRanges("Project Bluewing and project bluewing", [term("Project Bluewing"), term("Nowhere"), term("")]).map((r) => r.start)).toEqual([0, 21]);
  });
});

describe("已送審的標記（#242 PR 3）", () => {
  const written = { ...idle, hasInput: true, passages: 3, written: true };

  it("萃取完成且有送審的實體或關係時才算已送審", () => {
    expect(sentForReview(uploadSteps({ ...written, batches: [batch("done", 2, 1), batch("running")] }))).toBe(false);
    expect(sentForReview(uploadSteps({ ...written, batches: [batch("done", 2, 1), batch("done", 0, 1)] }))).toBe(true);
    // 什麼都沒找到：沒有送審，不飛
    expect(sentForReview(uploadSteps({ ...written, batches: [batch("done"), batch("done")] }))).toBe(false);
    expect(sentForReview(uploadSteps(idle))).toBe(false);
  });

  it("標記放在終點的中心，位移是起點中心減終點中心", () => {
    const from = { left: 400, top: 500, width: 100, height: 40 };
    const to = { left: 100, top: 200, width: 20, height: 10 };
    expect(flyPath(from, to, 12)).toEqual({ left: 104, top: 199, x: 340, y: 315 });
  });
});
