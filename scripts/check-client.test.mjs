import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIG_FILES, checkClient, validateClient } from "./check-client.mjs";

const readJson = (url) => JSON.parse(readFileSync(url, "utf8"));
const example = () => ({
  "client.json": readJson(new URL("../client/client.json", import.meta.url)),
  "theme.json": readJson(new URL("../client/theme.json", import.meta.url)),
});
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
      ]),
    );
    expect(errors).toContainEqual({ file: "client.json", path: "/displayName", message: "語言 fr 不在 client.json 的 languages 內" });
    expect(errors).toContainEqual({ file: "theme.json", path: "/fonts", message: "缺少必填欄位 heading" });
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

  it("Schema 涵蓋基本資訊、語言、模型、資料集與評測題庫位置、主題", () => {
    expect(Object.keys(CONFIG_FILES)).toEqual(["client.json", "theme.json"]);
    expect(schema("client.schema.json").required).toEqual(
      expect.arrayContaining(["displayName", "defaultLanguage", "languages", "model", "dataset", "evals"]),
    );
    expect(schema("client.schema.json").properties.languages.default).toEqual(["zh-TW", "en"]);
    expect(schema("theme.schema.json").required).toEqual(["colors", "fonts"]);
  });
});
