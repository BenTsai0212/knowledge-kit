import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { editDistance, nearMatch, planEntity, planRelation, type EntityPlan, type SeamContext, type SeamEntityInput, type VisibleEntity } from "./seams";

const ctx: SeamContext = { entityTypes: clientConfig.knowledgeModel.entityTypes, languages: ["zh-TW", "en"], documentLanguage: "zh-TW" };

// 看得到的實體（虛構）：兩位林志明、張雅婷、一個專案；team 類型的 mergeStrategy 是 auto，其餘是 review
const visible: VisibleEntity[] = [
  { id: "p-lin-1", type: "person", name: "林志明", names: { "zh-TW": "林志明", en: "Zhiming Lin" } },
  { id: "p-lin-2", type: "person", name: "林志明", names: { "zh-TW": "林志明", en: "Zhiming Lin" } },
  { id: "p-zhang", type: "person", name: "張雅婷", names: { "zh-TW": "張雅婷", en: "Yating Chang" } },
  { id: "pj-blue", type: "project", name: "青翼專案", names: { "zh-TW": "青翼專案", en: "Project Bluewing" } },
  { id: "t-ops", type: "team", name: "營運部", names: { "zh-TW": "營運部", en: "Operations" } },
];

const entity = (type: string, zh: string, en: string, unsure: SeamEntityInput["unsure"] = null): SeamEntityInput => ({
  id: "pe-1",
  type,
  names: { "zh-TW": zh, en },
  unsure,
});

describe("editDistance", () => {
  it("以 Unicode 字元計算", () => {
    expect(editDistance("張雅亭", "張雅婷")).toBe(1);
    expect(editDistance("張雅婷", "張雅婷")).toBe(0);
    expect(editDistance("張雅", "張雅婷")).toBe(1);
    expect(editDistance("張亭", "張雅婷")).toBe(2);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("planEntity（ADR 0011 決定 1、2）", () => {
  it("沒有候選、名稱完整：直接收錄為新實體", () => {
    expect(planEntity(entity("person", "測試人員甲", "Test Person A"), visible, ctx)).toEqual({ seams: [] });
  });

  it("只有一個候選：直接合併，不論 mergeStrategy（project 是 review、team 是 auto）", () => {
    expect(planEntity(entity("project", "青翼專案", "Bluewing"), visible, ctx)).toEqual({ seams: [], mergeInto: "pj-blue" });
    expect(planEntity(entity("team", "營運部", "Operations"), visible, ctx)).toEqual({ seams: [], mergeInto: "t-ops" });
  });

  it("合併候選 2 個以上是接縫（兩位林志明）", () => {
    expect(planEntity(entity("person", "林志明", "Zhiming Lin"), visible, ctx)).toEqual({ seams: ["candidates"] });
  });

  it("名稱缺少語言或空白是接縫", () => {
    expect(planEntity({ id: "pe-1", type: "person", names: { "zh-TW": "測試人員甲" }, unsure: null }, visible, ctx).seams).toEqual(["missing_language"]);
    expect(planEntity(entity("person", "測試人員甲", " "), visible, ctx).seams).toEqual(["missing_language"]);
  });

  it("新實體的文件語言名稱與看得到的同類型實體只差一個字是接縫；差 0 個字是合併、差 2 個字是新實體", () => {
    expect(planEntity(entity("person", "張雅亭", "Yating Zhang"), visible, ctx).seams).toEqual(["near_name"]);
    expect(planEntity(entity("person", "張雅婷", "Yating Chang"), visible, ctx)).toEqual({ seams: [], mergeInto: "p-zhang" });
    expect(planEntity(entity("person", "張亭", "Ting Zhang"), visible, ctx)).toEqual({ seams: [] });
  });

  it("編輯距離只比對同類型的實體，而且依類型的 aliasRules 正規化", () => {
    // 營運部（team）與「營運處」（project）類型不同
    expect(planEntity(entity("project", "營運處", "Ops Program"), visible, ctx)).toEqual({ seams: [] });
    // 大小寫與空白依 person 的 aliasRules 忽略：Yating Chang → yatingchang，文件語言是英文時比對
    const en: SeamContext = { ...ctx, documentLanguage: "en" };
    expect(planEntity(entity("person", "測試人員乙", "YATING CHANG"), visible, en)).toEqual({ seams: [], mergeInto: "p-zhang" });
    expect(planEntity(entity("person", "測試人員乙", "Yating Chan"), visible, en).seams).toEqual(["near_name"]);
  });

  it("同一份文件中兩個新的同類型實體只差一個字：兩個都是接縫；類型不同或差兩個字時不是", () => {
    const doc = (id: string, type: string, zh: string, en: string): SeamEntityInput => ({ id, type, names: { "zh-TW": zh, en }, unsure: null });
    // 看得到的實體中沒有測試人員丙、丁
    const a = doc("pe-1", "person", "測試人員丙", "Test Person C");
    const b = doc("pe-2", "person", "測試人員丁", "Test Person D");
    expect(planEntity(a, visible, ctx, [a, b]).seams).toEqual(["near_name"]);
    expect(planEntity(b, visible, ctx, [a, b]).seams).toEqual(["near_name"]);
    // 類型不同
    const team = doc("pe-2", "team", "測試人員丁", "Test Team D");
    expect(planEntity(a, visible, ctx, [a, team])).toEqual({ seams: [] });
    expect(planEntity(team, visible, ctx, [a, team])).toEqual({ seams: [] });
    // 只差兩個字
    const c = doc("pe-2", "person", "測試組員丁", "Test Member D");
    expect(planEntity(a, visible, ctx, [a, c])).toEqual({ seams: [] });
    expect(planEntity(c, visible, ctx, [a, c])).toEqual({ seams: [] });
    // 只有自己時不和自己比對
    expect(planEntity(a, visible, ctx, [a])).toEqual({ seams: [] });
  });

  it("類型的 nearName 是 false 時只差一個字也不是接縫，含同一份文件的比對；開啟或省略時照舊（#411）", () => {
    // 參考情境：person 開啟，team、project 關閉
    const byId = Object.fromEntries(ctx.entityTypes.map((t) => [t.id, t.nearName]));
    expect(byId).toEqual({ person: true, team: false, project: false });
    const doc = (id: string, zh: string, en: string): SeamEntityInput => ({ id, type: "team", names: { "zh-TW": zh, en }, unsure: null });
    // 營運處與看得到的營運部只差一個字；總務部與業務部是同一份文件的兩個新部門
    const ops = doc("pe-1", "營運處", "Operations Office");
    const a = doc("pe-2", "總務部", "General Affairs");
    const b = doc("pe-3", "業務部", "Sales");
    const off = [ops, a, b].map((e) => planEntity(e, visible, ctx, [ops, a, b]));
    expect(off).toEqual([{ seams: [] }, { seams: [] }, { seams: [] }]);
    // 同樣的實體，team 開啟或省略 nearName 時是接縫
    for (const nearName of [true, undefined]) {
      const on: SeamContext = { ...ctx, entityTypes: ctx.entityTypes.map((t) => (t.id === "team" ? { ...t, nearName } : t)) as SeamContext["entityTypes"] };
      expect([ops, a, b].map((e) => planEntity(e, visible, on, [ops, a, b]).seams)).toEqual([["near_name"], ["near_name"], ["near_name"]]);
    }
    // 關閉時 nearMatch 也不回傳對象（待審頁的提問依此）
    expect(nearMatch(ops, visible, [ops, a, b], ctx)).toBeNull();
  });

  it("模型標示沒把握是接縫；有多個原因時全部列出", () => {
    expect(planEntity(entity("person", "測試人員甲", "Test Person A", "possible_typo"), visible, ctx).seams).toEqual(["unsure"]);
    expect(planEntity(entity("person", "林志明", "", "same_name"), visible, ctx).seams).toEqual(["candidates", "missing_language", "unsure"]);
  });

  it("只有一個候選、但另有接縫原因時不帶合併對象", () => {
    expect(planEntity(entity("project", "青翼專案", "Bluewing", "other"), visible, ctx)).toEqual({ seams: ["unsure"] });
  });
});

describe("planRelation", () => {
  const plans = new Map<string, EntityPlan>([
    ["pe-ok", { seams: [] }],
    ["pe-merge", { seams: [], mergeInto: "pj-blue" }],
    ["pe-seam", { seams: ["candidates"] }],
  ]);

  it("兩端都不是接縫、沒有 unsure：不是接縫（不在清單中的端點交給 store.ts 查是否已核准）", () => {
    expect(planRelation({ id: "pr-1", from: "pe-ok", to: "pe-merge", unsure: null }, plans)).toEqual([]);
    expect(planRelation({ id: "pr-1", from: "pe-ok", to: "pe-earlier", unsure: null }, plans)).toEqual([]);
  });

  it("任一端是接縫時跟著留在接縫中；模型標示沒把握也是接縫", () => {
    expect(planRelation({ id: "pr-1", from: "pe-ok", to: "pe-seam", unsure: null }, plans)).toEqual(["endpoint"]);
    expect(planRelation({ id: "pr-1", from: "pe-seam", to: "pe-ok", unsure: "relation_wording" }, plans)).toEqual(["unsure", "endpoint"]);
  });
});
