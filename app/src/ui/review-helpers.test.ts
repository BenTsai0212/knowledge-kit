import { describe, expect, it } from "vitest";
import type { MergeSuggestion } from "../extraction/merge";
import type { ReviewDocument, ReviewEntity, ReviewRelation } from "../extraction/store";
import { batchPlan, canBatch, entityApproval, initialChoice, relationReady } from "./review-helpers";

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
const doc = (entities: ReviewEntity[], relations: ReviewRelation[]): ReviewDocument => ({ id: "d", title: "d", language: "zh-TW", entities, relations });

describe("initialChoice、canBatch、entityApproval", () => {
  it("new 建立新實體、auto 帶入合併對象、choose 尚未選擇且不能批次核准", () => {
    const suggestions: MergeSuggestion[] = [{ mode: "new" }, { mode: "auto", target: "team-ops" }, { mode: "choose", candidates: ["a", "b"] }];
    expect(suggestions.map(initialChoice)).toEqual([{ mergeInto: null }, { mergeInto: "team-ops" }, { mergeInto: undefined }]);
    expect(suggestions.map(canBatch)).toEqual([true, true, false]);
  });

  it("核准內容：還沒選擇時為 null；合併時不帶名稱；建立新實體時帶修改後的名稱", () => {
    expect(entityApproval("pe-1", { mergeInto: undefined })).toBeNull();
    expect(entityApproval("pe-1", { mergeInto: "team-ops", names: { en: "x" } })).toEqual({ id: "pe-1", mergeInto: "team-ops" });
    expect(entityApproval("pe-1", { mergeInto: null, names: { en: "x" } })).toEqual({ id: "pe-1", names: { en: "x" } });
    expect(entityApproval("pe-1", { mergeInto: null })).toEqual({ id: "pe-1" });
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
    expect(batchPlan(d, suggestions, choices)).toEqual({
      entities: [{ id: "pe-a" }, { id: "pe-b", mergeInto: "team-ops" }],
      relations: ["pr-ab", "pr-ad"],
    });
  });

  it("勾選的項目：只處理勾選的；關係的另一端沒有一起核准時不送出", () => {
    expect(batchPlan(d, suggestions, {}, new Set(["pe-a", "pr-ab", "pr-ad"]))).toEqual({ entities: [{ id: "pe-a" }], relations: ["pr-ad"] });
  });

  it("relationReady：兩端都已核准", () => {
    expect(relationReady(d, "pr-ad")).toBe(false);
    expect(relationReady(doc([entity("pe-a", "approved"), entity("pe-d", "approved")], [relation("pr-ad", "pe-a", "pe-d")]), "pr-ad")).toBe(true);
  });
});
