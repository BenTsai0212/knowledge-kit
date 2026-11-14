import { describe, expect, it } from "vitest";
import { canReupload, countsFromBatches, inProgressCount, myUploadStatus, reuploadOf, reviewCounts, reviewSteps, uploadTerms, type ReviewCounts } from "./my-uploads";

const counts = (c: Partial<ReviewCounts>): ReviewCounts => ({ extracting: false, total: 0, pending: 0, approved: 0, ...c });
const steps = (c: Partial<ReviewCounts>) => reviewSteps(counts(c)).map((s) => s.status);

describe("myUploadStatus（#284）", () => {
  it("沒有萃取出項目時是「已上傳」（萃取中、失敗或沒有找到，決定 4）", () => {
    expect(myUploadStatus(counts({}))).toBe("uploaded");
    expect(myUploadStatus(counts({ extracting: true }))).toBe("uploaded");
  });

  it("有任一項目還沒決定、或還在萃取時是審核中", () => {
    expect(myUploadStatus(counts({ total: 3, pending: 1, approved: 2 }))).toBe("in_review");
    expect(myUploadStatus(counts({ extracting: true, total: 2, pending: 0, approved: 2 }))).toBe("in_review");
  });

  it("全部核准、部分退回、全部退回（決定 3）", () => {
    expect(myUploadStatus(counts({ total: 3, approved: 3 }))).toBe("approved");
    expect(myUploadStatus(counts({ total: 3, approved: 1 }))).toBe("partly_rejected");
    expect(myUploadStatus(counts({ total: 3, approved: 0 }))).toBe("rejected");
  });

  it("只在退回時提供重新上傳修正版", () => {
    expect(["uploaded", "in_review", "approved", "partly_rejected", "rejected"].filter((s) => canReupload(s as never))).toEqual(["partly_rejected", "rejected"]);
  });
});

describe("reviewCounts", () => {
  it("實體與關係一起算；撤回後回到待審的項目算 pending", () => {
    const doc = {
      entities: [{ status: "approved" }, { status: "pending" }],
      relations: [{ status: "rejected" }],
    } as never;
    expect(reviewCounts(doc, false)).toEqual({ extracting: false, total: 3, pending: 1, approved: 1 });
  });
});

describe("reviewSteps：四步進度", () => {
  it("萃取中：已上傳完成、萃取完成進行中", () => {
    expect(steps({ extracting: true })).toEqual(["done", "active", "todo", "todo"]);
    expect(steps({ extracting: true, total: 2, pending: 2 })).toEqual(["done", "active", "todo", "todo"]);
  });

  it("沒有萃取出項目：停在已上傳", () => {
    expect(steps({})).toEqual(["done", "todo", "todo", "todo"]);
  });

  it("等主管審核", () => {
    expect(steps({ total: 2, pending: 2 })).toEqual(["done", "done", "active", "todo"]);
    expect(steps({ total: 2, pending: 1, approved: 1 })).toEqual(["done", "done", "active", "todo"]);
  });

  it("全部有決定且至少一項核准：出現在問答與圖譜；全部退回時不會", () => {
    expect(steps({ total: 2, approved: 2 })).toEqual(["done", "done", "done", "done"]);
    expect(steps({ total: 2, approved: 1 })).toEqual(["done", "done", "done", "done"]);
    expect(steps({ total: 2, approved: 0 })).toEqual(["done", "done", "done", "todo"]);
  });

  it("步驟的順序", () => {
    expect(reviewSteps(counts({})).map((s) => s.name)).toEqual(["uploaded", "extracted", "review", "published"]);
  });
});

describe("countsFromBatches：送出後還沒讀到待審項目時", () => {
  const batch = (status: string, entities = 0, relations = 0) => ({ status, entities, relations });

  it("還有等待或執行中的批次時是萃取中；完成的批次的送審筆數都在等審核", () => {
    expect(countsFromBatches([batch("done", 2, 1), batch("running")], false)).toEqual({ extracting: true, total: 3, pending: 3, approved: 0 });
    expect(countsFromBatches([batch("done", 2, 1), batch("done", 1)], false)).toEqual({ extracting: false, total: 4, pending: 4, approved: 0 });
  });

  it("全部失敗時不在萃取中，停在已上傳", () => {
    const c = countsFromBatches([batch("failed"), batch("failed")], false);
    expect(c.extracting).toBe(false);
    expect(myUploadStatus(c)).toBe("uploaded");
  });

  it("重試中（running）算萃取中", () => {
    expect(countsFromBatches([batch("failed")], true).extracting).toBe(true);
  });
});

describe("reuploadOf", () => {
  it("帶入標題、語言、可見等級與專案", () => {
    expect(reuploadOf({ title: "週報", language: "zh-TW", visibility: "internal", project: null })).toEqual({
      title: "週報",
      language: "zh-TW",
      visibility: "internal",
      project: null,
    });
  });
});

describe("inProgressCount（#344）：我的上傳 N", () => {
  const doc = (id: string, statuses: string[]) => ({ id, entities: statuses.map((status) => ({ status })), relations: [] }) as never;
  it("審核中與本工作階段還在萃取的才算；已核准、退回、沒有項目的不算", () => {
    const docs = [doc("a", ["pending", "approved"]), doc("b", ["approved"]), doc("c", ["rejected"]), doc("d", []), doc("e", [])];
    expect(inProgressCount(docs, new Set())).toBe(1);
    expect(inProgressCount(docs, new Set(["e"]))).toBe(2);
    expect(inProgressCount([], new Set())).toBe(0);
  });
});

describe("uploadTerms（#344）：原文中標出的實體", () => {
  it("各語言的名稱、類型與順序；同名只列一次，退回的實體不標", () => {
    const entities = [
      { type: "person", names: { "zh-TW": "林志明", en: "Zhiming Lin" }, status: "pending" },
      { type: "team", names: { "zh-TW": "營運部" }, status: "rejected" },
      { type: "project", names: { "zh-TW": "青翼專案", en: "Zhiming Lin" }, status: "approved" },
    ] as never;
    expect(uploadTerms({ entities })).toEqual([
      { name: "林志明", type: "person", order: 0 },
      { name: "Zhiming Lin", type: "person", order: 1 },
      { name: "青翼專案", type: "project", order: 2 },
    ]);
  });
});
