import { describe, expect, it } from "vitest";
import type { ConflictItem, ConflictPassage } from "../conflicts/store";
import type { MergeSuggestion } from "../extraction/merge";
import type { ReviewDocument, ReviewEntity, ReviewRelation } from "../extraction/store";
import {
  batchPlan,
  canBatch,
  entityApproval,
  highlightSegments,
  initialChoice,
  inputSize,
  namesComplete,
  namesInvalid,
  pendingCount,
  relationReady,
  reviewDocuments,
  toastText,
} from "./review-helpers";

const entity = (id: string, status: ReviewEntity["status"] = "pending"): ReviewEntity => ({
  id,
  type: "person",
  names: { "zh-TW": id, en: id },
  sources: [],
  status,
  mergedInto: null,
});
const relation = (id: string, from: string, to: string, status: ReviewRelation["status"] = "pending"): ReviewRelation => ({
  id,
  type: "member-of",
  from,
  to,
  sources: [],
  status,
  rejectedWithEntity: false,
});
const LANGS = ["zh-TW", "en"];
const doc = (entities: ReviewEntity[], relations: ReviewRelation[]): ReviewDocument => ({ id: "d", title: "d", language: "zh-TW", visibility: "public", project: null, entities, relations });

describe("initialChoice、canBatch、entityApproval", () => {
  it("new 建立新實體、auto 帶入合併對象、choose 尚未選擇且不能批次核准", () => {
    const suggestions: MergeSuggestion[] = [{ mode: "new" }, { mode: "auto", target: "team-ops" }, { mode: "choose", candidates: ["a", "b"] }];
    expect(suggestions.map(initialChoice)).toEqual([{ mergeInto: null }, { mergeInto: "team-ops" }, { mergeInto: undefined }]);
    expect(suggestions.map(canBatch)).toEqual([true, true, false]);
  });

  it("核准內容：還沒選擇時為 null；合併時不帶名稱；建立新實體時帶修改後、去掉前後空白的名稱", () => {
    expect(entityApproval("pe-1", { mergeInto: undefined }, LANGS)).toBeNull();
    expect(entityApproval("pe-1", { mergeInto: "team-ops", names: { "zh-TW": "", en: "x" } }, LANGS)).toEqual({ id: "pe-1", mergeInto: "team-ops" });
    expect(entityApproval("pe-1", { mergeInto: null, names: { "zh-TW": " 甲 ", en: "A " } }, LANGS)).toEqual({ id: "pe-1", names: { "zh-TW": "甲", en: "A" } });
    expect(entityApproval("pe-1", { mergeInto: null }, LANGS)).toEqual({ id: "pe-1" });
  });

  it("修改後的名稱：每種語言去掉前後空白後都要有值，否則不能核准（#47 審查）", () => {
    expect(namesComplete({ "zh-TW": "甲", en: "A" }, LANGS)).toBe(true);
    expect(namesComplete({ "zh-TW": "甲", en: "  " }, LANGS)).toBe(false);
    expect(namesComplete({ "zh-TW": "甲" }, LANGS)).toBe(false);
    expect(namesInvalid({ mergeInto: null, names: { "zh-TW": "", en: "A" } }, LANGS)).toBe(true);
    // 合併時不使用名稱；沒有修改時用待審的名稱
    expect(namesInvalid({ mergeInto: "team-ops", names: { "zh-TW": "", en: "A" } }, LANGS)).toBe(false);
    expect(namesInvalid({ mergeInto: null }, LANGS)).toBe(false);
    expect(entityApproval("pe-1", { mergeInto: null, names: { "zh-TW": " ", en: "A" } }, LANGS)).toBeNull();
  });
});

describe("batchPlan", () => {
  const d = doc(
    [entity("pe-a"), entity("pe-b"), entity("pe-c"), entity("pe-d", "approved"), entity("pe-e", "rejected")],
    [relation("pr-ab", "pe-a", "pe-b"), relation("pr-ac", "pe-a", "pe-c"), relation("pr-ad", "pe-a", "pe-d"), relation("pr-x", "pe-d", "pe-d", "approved")],
  );
  const suggestions: Record<string, MergeSuggestion> = {
    "pe-a": { mode: "new" },
    "pe-b": { mode: "auto", target: "team-ops" },
    "pe-c": { mode: "choose", candidates: ["person-lin-zhiming-rd", "person-lin-zhiming-sales"] },
  };

  it("整份文件：可以批次的待審實體，以及兩端都已核准或一起核准的關係；需要選擇的項目略過", () => {
    const choices = { "pe-a": { mergeInto: null }, "pe-b": { mergeInto: "team-ops" }, "pe-c": { mergeInto: "person-lin-zhiming-rd" } };
    expect(batchPlan(d, suggestions, choices, LANGS)).toEqual({
      entities: [{ id: "pe-a" }, { id: "pe-b", mergeInto: "team-ops" }],
      relations: ["pr-ab", "pr-ad"],
      skipped: 0,
    });
  });

  it("勾選的項目：只處理勾選的；關係的另一端沒有一起核准時不送出", () => {
    expect(batchPlan(d, suggestions, {}, LANGS, new Set(["pe-a", "pr-ab", "pr-ad"]))).toEqual({ entities: [{ id: "pe-a" }], relations: ["pr-ad"], skipped: 0 });
  });

  it("名稱不完整的實體略過並計數，依附它的關係也不送出", () => {
    const choices = { "pe-a": { mergeInto: null, names: { "zh-TW": "甲", en: " " } }, "pe-b": { mergeInto: "team-ops" } };
    expect(batchPlan(d, suggestions, choices, LANGS)).toEqual({ entities: [{ id: "pe-b", mergeInto: "team-ops" }], relations: [], skipped: 1 });
  });

  it("relationReady：兩端都已核准", () => {
    expect(relationReady(d, "pr-ad")).toBe(false);
    expect(relationReady(doc([entity("pe-a", "approved"), entity("pe-d", "approved")], [relation("pr-ad", "pe-a", "pe-d")]), "pr-ad")).toBe(true);
  });
});

describe("pendingCount", () => {
  it("只計算待審的實體與關係，跨文件加總", () => {
    const a = doc([entity("pe-a"), entity("pe-b", "approved"), entity("pe-c", "rejected")], [relation("pr-ab", "pe-a", "pe-b")]);
    const b = doc([entity("pe-d")], [relation("pr-x", "pe-d", "pe-d", "approved")]);
    expect(pendingCount([a, b])).toBe(3);
    expect(pendingCount([])).toBe(0);
  });

  it("加上待處理的說法不同（#51），已處理的不計", () => {
    const a = doc([entity("pe-a")], []);
    expect(pendingCount([a], [{ decision: null }, { decision: "coexist" }, { decision: null }])).toBe(3);
    expect(pendingCount([], [{ decision: "not_conflict" }])).toBe(0);
  });
});

describe("reviewDocuments", () => {
  const passage = (documentId: string): ConflictPassage => ({
    id: `${documentId}-p`,
    documentId,
    documentTitle: `標題 ${documentId}`,
    visibility: "internal",
    project: "bluewing",
    date: null,
    language: "en",
    content: "x",
  });
  const conflict = (id: string, documentId: string): ConflictItem => ({
    id,
    documentId,
    summary: "s",
    newPassage: passage(documentId),
    oldPassage: passage("old"),
    decision: null,
  });

  it("待審的文件在前；只有說法不同的文件以新段落的文件資訊補上，不重複", () => {
    const a = doc([entity("pe-a")], []);
    const docs = reviewDocuments([a], [conflict("pc-1", "d"), conflict("pc-2", "e"), conflict("pc-3", "e")]);
    expect(docs.map((d) => d.id)).toEqual(["d", "e"]);
    expect(docs[0]).toBe(a);
    expect(docs[1]).toEqual({ id: "e", title: "標題 e", language: "en", visibility: "internal", project: "bluewing", entities: [], relations: [] });
  });
});

describe("inputSize", () => {
  it("隨內容加寬，全形字元算 2 個，最少 8", () => {
    expect(inputSize("")).toBe(8);
    expect(inputSize("林志明")).toBe(8);
    expect(inputSize("Northern Region Operations Center")).toBe(35);
    expect(inputSize("北區營運中心資訊處")).toBe(20);
  });
});

describe("highlightSegments", () => {
  it("標出每一次出現的名稱，其餘是一般文字", () => {
    expect(highlightSegments("林志明與陳雅婷開會，林志明主持", ["林志明", "陳雅婷"])).toEqual([
      { text: "林志明", mark: true },
      { text: "與", mark: false },
      { text: "陳雅婷", mark: true },
      { text: "開會，", mark: false },
      { text: "林志明", mark: true },
      { text: "主持", mark: false },
    ]);
  });

  it("不分大小寫、保留原文；同一位置取較長的名稱", () => {
    expect(highlightSegments("The Ops Team met ops team leads.", ["ops", "Ops Team"])).toEqual([
      { text: "The ", mark: false },
      { text: "Ops Team", mark: true },
      { text: " met ", mark: false },
      { text: "ops team", mark: true },
      { text: " leads.", mark: false },
    ]);
  });

  it("沒有名稱或找不到時整段是一般文字；空白的名稱忽略", () => {
    expect(highlightSegments("沒有提到", ["林志明", " "])).toEqual([{ text: "沒有提到", mark: false }]);
    expect(highlightSegments("abc", [])).toEqual([{ text: "abc", mark: false }]);
    expect(highlightSegments("", ["a"])).toEqual([]);
  });

  it("模型輸出的標記字元只是文字", () => {
    expect(highlightSegments("<b>林志明</b>", ["林志明"])).toEqual([
      { text: "<b>", mark: false },
      { text: "林志明", mark: true },
      { text: "</b>", mark: false },
    ]);
  });
});

describe("toastText", () => {
  const approved = { one: "已核准：{name}", many: "已核准 {count} 筆" };

  it("一筆時顯示項目名稱，實體與關係相同", () => {
    expect(toastText(approved, ["鄭書豪"])).toBe("已核准：鄭書豪");
    expect(toastText({ one: "已退回：{name}", many: "已退回 {count} 筆" }, ["周大衛 —隸屬→ 王小明"])).toBe("已退回：周大衛 —隸屬→ 王小明");
  });

  it("多筆時顯示筆數", () => {
    expect(toastText(approved, ["甲", "乙", "丙"])).toBe("已核准 3 筆");
    expect(toastText({ one: "Approved: {name}", many: "{count} approved" }, ["a", "b"])).toBe("2 approved");
  });

  it("名稱中的替換字元與標記原樣保留", () => {
    expect(toastText(approved, ["$& <b>甲</b> $1"])).toBe("已核准：$& <b>甲</b> $1");
  });
});
