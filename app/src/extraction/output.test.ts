import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { ExtractionFormatError, parseExtraction } from "./output";

const NUMBERING = ["p-a", "p-b"];
const LANGS = clientConfig.client.languages;
const parse = (value: unknown) => parseExtraction(typeof value === "string" ? value : JSON.stringify(value), NUMBERING, clientConfig.knowledgeModel, LANGS);
const person = (key: string, extra: object = {}) => ({ key, type: "person", names: { "zh-TW": "測試人員甲", en: "Test Person A" }, sources: [1], ...extra });
const team = (key: string) => ({ key, type: "team", names: { "zh-TW": "營運部", en: "Operations" }, sources: [2] });

describe("parseExtraction", () => {
  it("編號轉成段落 id；去掉 ``` 外框", () => {
    const text = "```json\n" + JSON.stringify({ entities: [person("e1"), team("e2")], relations: [{ type: "member-of", from: "e1", to: "e2", sources: [1, 2] }] }) + "\n```";
    expect(parse(text)).toEqual({
      entities: [
        { key: "e1", type: "person", names: { "zh-TW": "測試人員甲", en: "Test Person A" }, sources: ["p-a"] },
        { key: "e2", type: "team", names: { "zh-TW": "營運部", en: "Operations" }, sources: ["p-b"] },
      ],
      relations: [{ type: "member-of", from: "e1", to: "e2", sources: ["p-a", "p-b"] }],
      dropped: {},
    });
  });

  it("出處：不在這一批的編號去掉；一個都不剩的項目捨棄", () => {
    const result = parse({ entities: [person("e1", { sources: [1, 3, 0] }), person("e2", { sources: [9] }), person("e3", { sources: [] })], relations: [] });
    expect(result.entities.map((e) => [e.key, e.sources])).toEqual([["e1", ["p-a"]]]);
    expect(result.dropped).toEqual({ no_sources: 2 });
  });

  it("類型必須存在於 knowledge-model.json", () => {
    const result = parse({ entities: [person("e1"), { ...team("e2"), type: "vendor" }], relations: [{ type: "owns", from: "e1", to: "e1", sources: [1] }] });
    expect(result.entities.map((e) => e.key)).toEqual(["e1"]);
    expect(result.dropped).toEqual({ unknown_type: 2 });
  });

  it("關係方向：兩端的類型必須符合 from／to；依附於被捨棄實體的關係一併捨棄", () => {
    const result = parse({
      entities: [person("e1"), team("e2"), { ...person("e3"), type: "vendor" }],
      relations: [
        { type: "member-of", from: "e2", to: "e1", sources: [1] },
        { type: "member-of", from: "e1", to: "e3", sources: [1] },
        { type: "member-of", from: "e1", to: "e2", sources: [1] },
      ],
    });
    expect(result.relations.map((r) => [r.from, r.to])).toEqual([["e1", "e2"]]);
    expect(result.dropped).toEqual({ unknown_type: 1, type_mismatch: 1, bad_endpoint: 1 });
  });

  it("名稱語言：缺少任何一種語言或為空白時捨棄；多的語言忽略", () => {
    const result = parse({
      entities: [
        person("e1", { names: { "zh-TW": "測試人員甲" } }),
        person("e2", { names: { "zh-TW": " ", en: "x" } }),
        person("e3", { names: { "zh-TW": " 測試人員乙 ", en: "Test Person B", ja: "テスト" } }),
      ],
      relations: [],
    });
    expect(result.entities.map((e) => e.names)).toEqual([{ "zh-TW": "測試人員乙", en: "Test Person B" }]);
    expect(result.dropped).toEqual({ bad_names: 2 });
  });

  it("同一批中重複的 key 只保留第一筆", () => {
    expect(parse({ entities: [person("e1"), team("e1")], relations: [] }).dropped).toEqual({ duplicate_key: 1 });
  });

  it("格式錯誤：不是 JSON、不是物件、缺少陣列、項目的形狀不對", () => {
    for (const bad of ["這不是 JSON", "[]", JSON.stringify({ entities: [] }), JSON.stringify({ entities: [{ key: 1 }], relations: [] }), JSON.stringify({ entities: [], relations: [{ type: "x" }] })]) {
      expect(() => parse(bad), bad).toThrow(ExtractionFormatError);
    }
  });

  it("沒有可萃取的內容", () => {
    expect(parse({ entities: [], relations: [] })).toEqual({ entities: [], relations: [], dropped: {} });
  });
});
