import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIG_FILES, checkClient, validateClient } from "./check-client.mjs";

const readJson = (url) => JSON.parse(readFileSync(url, "utf8"));
const example = () =>
  Object.fromEntries(Object.keys(CONFIG_FILES).map((f) => [f, readJson(new URL(`../client/${f}`, import.meta.url))]));
const schema = (name) => readJson(new URL(`../client/schema/${name}`, import.meta.url));

describe("check-client", () => {
  it("client/ 的範例設定通過驗證", () => {
    expect(checkClient()).toEqual([]);
  });

  it("故意寫錯的設定會失敗，並指出檔名與欄位", () => {
    const errors = checkClient(new URL("./fixtures/invalid-client/", import.meta.url));
    const where = errors.map((e) => `${e.file} ${e.path}`);
    expect(where).toEqual(
      expect.arrayContaining([
        "client.json /displayName",
        "client.json /defaultLanguage",
        "client.json /model",
        "client.json /dataset/path",
        "theme.json /colors/primary",
        "theme.json /fonts",
        "scenarios.json /scenarios/0/title",
        "knowledge-model.json /entityTypes/1/id",
        "knowledge-model.json /relationTypes/0/to/0",
        "access.json /visibilityLevels/1/rank",
        "access.json /roles/0/visibility",
        "access.json /roles/0/projects/1",
      ]),
    );
    expect(errors).toContainEqual({ file: "client.json", path: "/displayName", message: "語言 fr 不在 client.json 的 languages 內" });
    expect(errors).toContainEqual({ file: "theme.json", path: "/fonts", message: "缺少必填欄位 heading" });
    expect(errors).toContainEqual({ file: "access.json", path: "/roles/0/projects/1", message: "專案 unknown 不存在" });
  });

  it("LocalizedText 缺少預設語言時失敗", () => {
    const files = example();
    files["client.json"].displayName = { en: "Example Co." };
    expect(validateClient(files)).toEqual([
      { file: "client.json", path: "/displayName", message: "缺少預設語言 zh-TW" },
    ]);
  });

  it("LocalizedText 的鍵不是語言代碼時失敗", () => {
    const files = example();
    files["client.json"].displayName = { "zh-TW": "範例公司", name: "x" };
    expect(validateClient(files).map((e) => e.path)).toContain("/displayName");
  });

  it("缺少設定檔、未知的設定檔、多餘欄位都會失敗", () => {
    const files = example();
    delete files["theme.json"];
    files["extra.json"] = {};
    files["client.json"].logo = "logo.png";
    expect(validateClient(files)).toEqual(
      expect.arrayContaining([
        { file: "theme.json", path: "/", message: "缺少設定檔" },
        { file: "extra.json", path: "/", message: "未知的設定檔" },
        { file: "client.json", path: "/", message: "不允許的欄位 logo" },
      ]),
    );
  });

  it("模型只接受代號格式", () => {
    const files = example();
    files["client.json"].model = "standard.v2";
    expect(validateClient(files).map((e) => e.path)).toEqual(["/model"]);
  });

  it("合併策略只接受 review 或 auto，省略時預設 review", () => {
    const files = example();
    files["knowledge-model.json"].entityTypes[0].mergeStrategy = "merge";
    expect(validateClient(files).map((e) => e.path)).toEqual(["/entityTypes/0/mergeStrategy"]);
    expect(schema("knowledge-model.schema.json").properties.entityTypes.items.properties.mergeStrategy.default).toBe("review");
  });

  it("情境的角色與問題 id 會被檢查", () => {
    const files = example();
    files["scenarios.json"].scenarios[0].role = "director";
    files["scenarios.json"].scenarios[0].questions.push({ id: "aurora-lead", text: { "zh-TW": "重複" } });
    expect(validateClient(files)).toEqual([
      { file: "scenarios.json", path: "/scenarios/0/questions/2/id", message: "id aurora-lead 重複" },
      { file: "scenarios.json", path: "/scenarios/0/role", message: "角色 director 不存在" },
    ]);
  });

  it("Schema 涵蓋 Issue #5 的 8 類客戶差異", () => {
    const props = (name) => schema(name).properties;
    const item = (name, key) => props(name)[key].items.properties;
    // 基本資訊（顯示名稱、預設語言、支援語言）
    expect(props("client.schema.json")).toHaveProperty("displayName");
    expect(props("client.schema.json")).toHaveProperty("defaultLanguage");
    expect(props("client.schema.json").languages.default).toEqual(["zh-TW", "en"]);
    // 知識模型（實體類型、關係類型、別名規則）
    expect(item("knowledge-model.schema.json", "entityTypes")).toHaveProperty("aliasRules");
    expect(props("knowledge-model.schema.json")).toHaveProperty("relationTypes");
    // 角色與權限（角色、可見等級、專案名單）
    expect(Object.keys(props("access.schema.json"))).toEqual(["visibilityLevels", "projects", "roles"]);
    // 示範情境與預設問題
    expect(item("scenarios.schema.json", "scenarios")).toHaveProperty("questions");
    // 評測題庫的位置、模型代號、資料集的位置
    expect(props("client.schema.json")).toHaveProperty("evals");
    expect(props("client.schema.json").model.$ref).toBe("common.schema.json#/definitions/ModelCode");
    expect(props("client.schema.json")).toHaveProperty("dataset");
    // 主題（色票、字體）
    expect(schema("theme.schema.json").required).toEqual(["colors", "fonts"]);
  });
});
