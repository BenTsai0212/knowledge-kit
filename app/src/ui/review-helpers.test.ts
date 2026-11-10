import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import type { ConflictItem, ConflictPassage } from "../conflicts/store";
import { dataset } from "../dataset/load";
import { suggestMerge, type MergeSuggestion } from "../extraction/merge";
import type { ReviewDocument, ReviewEntity, ReviewRelation } from "../extraction/store";
import {
  batchPlan,
  canBatch,
  entityApproval,
  existingRelation,
  groupPlan,
  highlightSegments,
  initialChoice,
  inputSize,
  isSuggested,
  namesComplete,
  namesInvalid,
  pendingCount,
  relationReady,
  reviewDocuments,
  reviewGroups,
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
const NO_GRAPH = { relations: [] };
const doc = (entities: ReviewEntity[], relations: ReviewRelation[]): ReviewDocument => ({ id: "d", title: "d", language: "zh-TW", visibility: "public", project: null, entities, relations });

describe("initialChoice、canBatch、entityApproval", () => {
  it("new 建立新實體、auto 帶入合併對象、choose 有兩個以上候選時尚未選擇且不能批次核准", () => {
    const suggestions: MergeSuggestion[] = [{ mode: "new" }, { mode: "auto", target: "team-ops" }, { mode: "choose", candidates: ["a", "b"] }];
    expect(suggestions.map(initialChoice)).toEqual([{ mergeInto: null }, { mergeInto: "team-ops" }, { mergeInto: undefined }]);
    expect(suggestions.map(canBatch)).toEqual([true, true, false]);
  });

  it("系統建議：choose 只有一個候選時預先帶入、可以批次核准（#189）", () => {
    const one: MergeSuggestion = { mode: "choose", candidates: ["person-zhang-yating"] };
    expect(isSuggested(one)).toBe(true);
    expect(initialChoice(one)).toEqual({ mergeInto: "person-zhang-yating" });
    expect(canBatch(one)).toBe(true);
    // 兩位林志明仍逐筆選擇
    const two: MergeSuggestion = { mode: "choose", candidates: ["person-lin-zhiming-rd", "person-lin-zhiming-sales"] };
    expect(isSuggested(two)).toBe(false);
    expect(isSuggested({ mode: "auto", target: "team-ops" })).toBe(false);
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
    expect(batchPlan(d, suggestions, choices, LANGS, NO_GRAPH)).toEqual({
      entities: [{ id: "pe-a" }, { id: "pe-b", mergeInto: "team-ops" }],
      relations: ["pr-ab", "pr-ad"],
      existingRelations: [],
      skipped: 0,
    });
  });

  it("勾選的項目：只處理勾選的；關係的另一端沒有一起核准時不送出", () => {
    expect(batchPlan(d, suggestions, {}, LANGS, NO_GRAPH, new Set(["pe-a", "pr-ab", "pr-ad"]))).toEqual({
      entities: [{ id: "pe-a" }],
      relations: ["pr-ad"],
      existingRelations: [],
      skipped: 0,
    });
  });

  it("名稱不完整的實體略過並計數，依附它的關係也不送出", () => {
    const choices = { "pe-a": { mergeInto: null, names: { "zh-TW": "甲", en: " " } }, "pe-b": { mergeInto: "team-ops" } };
    expect(batchPlan(d, suggestions, choices, LANGS, NO_GRAPH)).toEqual({ entities: [{ id: "pe-b", mergeInto: "team-ops" }], relations: [], existingRelations: [], skipped: 1 });
  });

  it("relationReady：兩端都已核准", () => {
    expect(relationReady(d, "pr-ad")).toBe(false);
    expect(relationReady(doc([entity("pe-a", "approved"), entity("pe-d", "approved")], [relation("pr-ad", "pe-a", "pe-d")]), "pr-ad")).toBe(true);
  });
});

// 走查用的通知（#189，虛構）：主管上傳「長堤專案第二階段啟動通知」後的 11 筆待審，與參考情境的圖譜比對
describe("系統建議與分組：走查用的通知", () => {
  const e = (id: string, type: string, zh: string, en: string): ReviewEntity => ({ ...entity(id), type, names: { "zh-TW": zh, en } });
  const r = (id: string, type: string, from: string, to: string): ReviewRelation => ({ ...relation(id, from, to), type });
  const walkthrough = doc(
    [
      e("pe-zhang", "person", "張雅婷", "Yating Chang"),
      e("pe-ops", "team", "營運部", "Operations"),
      e("pe-longpier", "project", "長堤專案", "Project Longpier"),
      e("pe-chen", "person", "陳柏翰", "Bohan Chen"),
      e("pe-huang", "person", "黃建宏", "Jianhong Huang"),
    ],
    [
      r("pr-zhang-ops", "member-of", "pe-zhang", "pe-ops"),
      r("pr-zhang-leads-ops", "leads", "pe-zhang", "pe-ops"),
      r("pr-chen-ops", "member-of", "pe-chen", "pe-ops"),
      r("pr-chen-longpier", "leads", "pe-chen", "pe-longpier"),
      r("pr-ops-longpier", "works-on", "pe-ops", "pe-longpier"),
      r("pr-huang-longpier", "works-on", "pe-huang", "pe-longpier"),
    ],
  );
  const graph = {
    entities: dataset.entities.entities.map((x) => ({ ...x, sources: [] })),
    relations: dataset.relations.relations.map((x) => ({ ...x, sources: [] })),
  };
  const suggestions = Object.fromEntries(walkthrough.entities.map((x) => [x.id, suggestMerge(x, graph.entities, clientConfig.knowledgeModel.entityTypes)]));
  const choices = Object.fromEntries(walkthrough.entities.map((x) => [x.id, initialChoice(suggestions[x.id])]));

  it("同名且只有一個候選的實體是系統建議；只有新增的陳柏翰需要確認", () => {
    expect(suggestions["pe-zhang"]).toEqual({ mode: "choose", candidates: ["person-zhang-yating"] });
    const g = reviewGroups(walkthrough, suggestions, choices, graph, LANGS);
    expect(g.groups.map((x) => [x.entity.id, x.kind, x.blocked])).toEqual([["pe-chen", "new", undefined]]);
    expect(g.groups[0].relations.map((x) => [x.relation.id, x.existing])).toEqual([
      ["pr-chen-ops", false],
      ["pr-chen-longpier", false],
    ]);
    expect(g.prepared.entities.map((x) => x.id)).toEqual(["pe-zhang", "pe-ops", "pe-longpier", "pe-huang"]);
    expect(g.prepared.relations.map((x) => [x.relation.id, x.existing])).toEqual([
      ["pr-zhang-ops", true],
      ["pr-zhang-leads-ops", true],
      ["pr-ops-longpier", true],
      ["pr-huang-longpier", true],
    ]);
    expect(g.summary).toEqual({ newEntities: 1, mergedEntities: 4, newRelations: 2, existingRelations: 4, toConfirm: 1 });
  });

  it("核准這份文件的全部：11 筆都包含在內，圖譜已有的關係不重複建立", () => {
    const plan = batchPlan(walkthrough, suggestions, choices, LANGS, graph);
    expect(plan.entities).toEqual([
      { id: "pe-zhang", mergeInto: "person-zhang-yating" },
      { id: "pe-ops", mergeInto: "team-ops" },
      { id: "pe-longpier", mergeInto: "project-longpier" },
      { id: "pe-chen" },
      { id: "pe-huang", mergeInto: "person-huang-jianhong" },
    ]);
    expect(plan.relations).toEqual(["pr-chen-ops", "pr-chen-longpier"]);
    expect(plan.existingRelations).toEqual(["pr-zhang-ops", "pr-zhang-leads-ops", "pr-ops-longpier", "pr-huang-longpier"]);
    expect(plan.skipped).toBe(0);
  });

  it("圖譜已有依目前的選擇計算：一端改成建立新實體後就不是；已核准的一端用核准時的合併對象", () => {
    const rel = walkthrough.relations[0];
    expect(existingRelation(walkthrough, rel, choices, graph)?.id).toBe("zhang-member-of-ops");
    expect(existingRelation(walkthrough, rel, { ...choices, "pe-zhang": { mergeInto: null } }, graph)).toBeUndefined();
    expect(existingRelation(walkthrough, rel, { ...choices, "pe-zhang": { mergeInto: undefined } }, graph)).toBeUndefined();
    const approved = doc([{ ...walkthrough.entities[0], status: "approved", mergedInto: "person-zhang-yating" }, walkthrough.entities[1]], [rel]);
    expect(existingRelation(approved, rel, { "pe-ops": { mergeInto: "team-ops" } }, graph)?.id).toBe("zhang-member-of-ops");
    // 方向或類型不同不算
    expect(existingRelation(walkthrough, { ...rel, from: "pe-ops", to: "pe-zhang" }, choices, graph)).toBeUndefined();
    expect(existingRelation(walkthrough, { ...rel, type: "works-on" }, choices, graph)).toBeUndefined();
  });
});

describe("reviewGroups：需要決定的組", () => {
  const lin = { ...entity("pe-lin"), names: { "zh-TW": "林志明", en: "Zhiming Lin" } };
  const d = doc([lin, entity("pe-new"), entity("pe-ops", "approved")], [relation("pr-lin-ops", "pe-lin", "pe-ops"), relation("pr-new-lin", "pe-new", "pe-lin")]);
  const suggestions: Record<string, MergeSuggestion> = {
    "pe-lin": { mode: "choose", candidates: ["person-lin-zhiming-rd", "person-lin-zhiming-sales"] },
    "pe-new": { mode: "new" },
  };

  it("兩位林志明逐筆選擇：還沒選擇時標示原因，選擇後仍留在同一組；關係掛在第一個需要確認的端點底下", () => {
    const g = reviewGroups(d, suggestions, {}, NO_GRAPH, LANGS);
    expect(g.groups.map((x) => [x.entity.id, x.kind, x.blocked, x.relations.map((r) => r.relation.id)])).toEqual([
      ["pe-lin", "decide", "choose", ["pr-lin-ops"]],
      ["pe-new", "new", undefined, ["pr-new-lin"]],
    ]);
    expect(g.summary.toConfirm).toBe(2);
    const chosen = reviewGroups(d, suggestions, { "pe-lin": { mergeInto: "person-lin-zhiming-rd" } }, NO_GRAPH, LANGS);
    expect(chosen.groups.map((x) => [x.entity.id, x.blocked])).toEqual([
      ["pe-lin", undefined],
      ["pe-new", undefined],
    ]);
    expect(batchPlan(d, suggestions, {}, LANGS, NO_GRAPH).entities).toEqual([{ id: "pe-new" }]);
  });

  it("新增的實體名稱不完整時標示原因", () => {
    const g = reviewGroups(d, suggestions, { "pe-new": { mergeInto: null, names: { "zh-TW": "甲", en: "" } } }, NO_GRAPH, LANGS);
    expect(g.groups.find((x) => x.entity.id === "pe-new")?.blocked).toBe("names");
  });

  it("groupPlan：確認一組＝實體加上兩端都已核准或一起核准的關係；需要逐筆選擇的實體選擇後才能確認", () => {
    const g = reviewGroups(d, suggestions, {}, NO_GRAPH, LANGS);
    const [lin, created] = g.groups;
    expect(groupPlan(d, lin, { "pe-lin": { mergeInto: undefined } }, LANGS)).toBeNull();
    expect(groupPlan(d, lin, { "pe-lin": { mergeInto: "person-lin-zhiming-rd" } }, LANGS)).toEqual({
      entities: [{ id: "pe-lin", mergeInto: "person-lin-zhiming-rd" }],
      relations: ["pr-lin-ops"],
      existingRelations: [],
    });
    // pr-new-lin 的另一端（林志明）還待審：留在組裡，不送出
    expect(groupPlan(d, created, {}, LANGS)).toEqual({ entities: [{ id: "pe-new" }], relations: [], existingRelations: [] });
    expect(groupPlan(d, created, { "pe-new": { mergeInto: null, names: { "zh-TW": "甲", en: "" } } }, LANGS)).toBeNull();
  });

  it("groupPlan：圖譜已有的關係只寫決定", () => {
    const graph = { relations: [{ id: "lin-member-of-ops", type: "member-of", from: "person-lin-zhiming-rd", to: "pe-ops", sources: [] }] };
    const choices = { "pe-lin": { mergeInto: "person-lin-zhiming-rd" } };
    const g = reviewGroups(d, suggestions, choices, graph, LANGS);
    expect(groupPlan(d, g.groups[0], choices, LANGS)).toEqual({
      entities: [{ id: "pe-lin", mergeInto: "person-lin-zhiming-rd" }],
      relations: [],
      existingRelations: ["pr-lin-ops"],
    });
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
