import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import type { ClientConfig } from "../client/types";
import { nameKeys, normalizeName, suggestMerge } from "./merge";

const ALL = { ignoreCase: true, normalizeWidth: true, ignoreWhitespace: true };
const types = clientConfig.knowledgeModel.entityTypes;

describe("normalizeName：aliasRules 的三個選項", () => {
  it("normalizeWidth：全形轉半形", () => {
    expect(normalizeName("ＡＢＣ１２３", { ...ALL, ignoreCase: false })).toBe("ABC123");
    expect(normalizeName("ＡＢＣ", { ...ALL, normalizeWidth: false, ignoreCase: false })).toBe("ＡＢＣ");
  });

  it("ignoreCase：不分大小寫", () => {
    expect(normalizeName("Zhiming Lin", ALL)).toBe("zhiminglin");
    expect(normalizeName("Zhiming Lin", { ...ALL, ignoreCase: false })).toBe("ZhimingLin");
  });

  it("ignoreWhitespace：去掉空白（含全形空白）", () => {
    expect(normalizeName("林　志明", ALL)).toBe("林志明");
    expect(normalizeName("Project  Bluewing", { ...ALL, ignoreWhitespace: false })).toBe("project  bluewing");
  });

  it("不認得的類型沒有比對鍵", () => {
    expect(nameKeys("vendor", ["x"], types).size).toBe(0);
  });
});

const entity = (id: string, type: string, name: string, en: string) => ({ id, type, name, names: { "zh-TW": name, en } });
const VISIBLE = [
  entity("person-lin-zhiming-rd", "person", "林志明", "Zhiming Lin"),
  entity("person-lin-zhiming-sales", "person", "林志明", "Zhiming Lin"),
  entity("person-wang-xiaoming", "person", "王小明", "Ming Wang"),
  entity("team-ops", "team", "營運部", "Operations"),
  entity("project-bluewing", "project", "青翼專案", "Project Bluewing"),
];

describe("suggestMerge", () => {
  it("沒有相符的實體：建立新實體", () => {
    expect(suggestMerge({ type: "person", names: { "zh-TW": "測試人員甲", en: "Test Person A" } }, VISIBLE, types)).toEqual({ mode: "new" });
  });

  it("review（人員）：有候選時由核准者選擇，不能批次核准", () => {
    expect(suggestMerge({ type: "person", names: { "zh-TW": "王小明", en: "Ming Wang" } }, VISIBLE, types)).toEqual({
      mode: "choose",
      candidates: ["person-wang-xiaoming"],
    });
  });

  it("同名不同人：兩位林志明都是候選", () => {
    expect(suggestMerge({ type: "person", names: { "zh-TW": "林志明", en: "Zhiming Lin" } }, VISIBLE, types)).toEqual({
      mode: "choose",
      candidates: ["person-lin-zhiming-rd", "person-lin-zhiming-sales"],
    });
  });

  it("auto（部門）：剛好一個候選時自動帶入；比對任一語言的名稱並套用 aliasRules", () => {
    expect(suggestMerge({ type: "team", names: { "zh-TW": "營運", en: "OPERATIONS" } }, VISIBLE, types)).toEqual({ mode: "auto", target: "team-ops" });
  });

  it("auto 但有多個候選：逐筆選擇（#44 決定 4）", () => {
    const twoOps = [...VISIBLE, entity("team-ops-2", "team", "營運部", "Operations")];
    expect(suggestMerge({ type: "team", names: { "zh-TW": "營運部", en: "Operations" } }, twoOps, types)).toEqual({
      mode: "choose",
      candidates: ["team-ops", "team-ops-2"],
    });
  });

  it("只比對傳入的實體（核准者看得到的）與相同類型", () => {
    expect(suggestMerge({ type: "project", names: { "zh-TW": "長堤專案", en: "Project Longpier" } }, VISIBLE, types)).toEqual({ mode: "new" });
    expect(suggestMerge({ type: "project", names: { "zh-TW": "營運部", en: "Operations" } }, VISIBLE, types)).toEqual({ mode: "new" });
  });

  it("aliasRules 依類型套用：project 不忽略空白", () => {
    const strict: ClientConfig["knowledgeModel"]["entityTypes"] = types;
    expect(suggestMerge({ type: "project", names: { "zh-TW": "青翼 專案", en: "ProjectBluewing" } }, VISIBLE, strict)).toEqual({ mode: "new" });
  });
});
