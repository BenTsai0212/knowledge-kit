import { describe, expect, it } from "vitest";
import { uploadSteps, passagesWordCount, type UploadProgress } from "./upload-helpers";

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
