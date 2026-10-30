import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIG_FILES, DATASET_FILES, I18N_DIR, checkClient, validateClient } from "./check-client.mjs";

const readJson = (url) => JSON.parse(readFileSync(url, "utf8"));
const example = () =>
  Object.fromEntries(Object.keys(CONFIG_FILES).map((f) => [f, readJson(new URL(`../client/${f}`, import.meta.url))]));
const schema = (name) => readJson(new URL(`../client/schema/${name}`, import.meta.url));
const i18n = () =>
  Object.fromEntries(["zh-TW", "en"].map((l) => [l, readJson(new URL(`../client/${I18N_DIR}${l}.json`, import.meta.url))]));
const DOC = "documents/employee-handbook.zh-TW.json";
const dataset = () => ({
  root: "data/",
  files: Object.fromEntries(
    [...Object.keys(DATASET_FILES), DOC].map((f) => [f, readJson(new URL(`../client/data/${f}`, import.meta.url))]),
  ),
});

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
        "theme.json /colors/overlay",
        "theme.json /radius/pill",
        "theme.json /fonts",
        "scenarios.json /scenarios/0/title",
        "knowledge-model.json /entityTypes/1/id",
        "knowledge-model.json /relationTypes/0/to/0",
        "access.json /visibilityLevels/1/rank",
        "access.json /roles/0/visibility",
        "access.json /roles/0/projects/1",
        "client.json /evals/path",
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

  it("檢索參數：provider 只接受已登記的實作，topK 與 minScore 有範圍，可省略", () => {
    const files = example();
    files["client.json"].retrieval = { provider: "pgvector", topK: 0, minScore: 1.5 };
    expect(validateClient(files).map((e) => e.path)).toEqual(["/retrieval/provider", "/retrieval/topK", "/retrieval/minScore"]);
    delete files["client.json"].retrieval;
    expect(validateClient(files)).toEqual([]);
  });

  it("上傳參數：passageMaxChars 為 100～1000、extractMaxBatches 為 1～10 的整數，可省略", () => {
    const files = example();
    files["client.json"].upload = { passageMaxChars: 50 };
    expect(validateClient(files).map((e) => e.path)).toEqual(["/upload/passageMaxChars"]);
    files["client.json"].upload = { passageMaxChars: 300.5 };
    expect(validateClient(files).map((e) => e.path)).toEqual(["/upload/passageMaxChars"]);
    files["client.json"].upload = { extractMaxBatches: 0 };
    expect(validateClient(files).map((e) => e.path)).toEqual(["/upload/extractMaxBatches"]);
    files["client.json"].upload = { extractMaxBatches: 11 };
    expect(validateClient(files).map((e) => e.path)).toEqual(["/upload/extractMaxBatches"]);
    delete files["client.json"].upload;
    expect(validateClient(files)).toEqual([]);
  });

  it("合併策略只接受 review 或 auto，省略時預設 review", () => {
    const files = example();
    files["knowledge-model.json"].entityTypes[0].mergeStrategy = "merge";
    expect(validateClient(files).map((e) => e.path)).toEqual(["/entityTypes/0/mergeStrategy"]);
    expect(schema("knowledge-model.schema.json").properties.entityTypes.items.properties.mergeStrategy.default).toBe("review");
  });

  it("實體類型的顏色必填，格式為 #RRGGBB", () => {
    const files = example();
    files["knowledge-model.json"].entityTypes[0].color = "blue";
    delete files["knowledge-model.json"].entityTypes[1].color;
    expect(validateClient(files).map((e) => e.path)).toEqual(["/entityTypes/0/color", "/entityTypes/1"]);
  });

  it("可見等級的顏色必填，格式為 #RRGGBB", () => {
    const files = example();
    files["access.json"].visibilityLevels[0].color = "green";
    delete files["access.json"].visibilityLevels[1].color;
    expect(validateClient(files).map((e) => e.path)).toEqual(["/visibilityLevels/0/color", "/visibilityLevels/1"]);
  });

  it("角色的 canReview 必填，只接受 boolean", () => {
    const files = example();
    delete files["access.json"].roles[0].canReview;
    files["access.json"].roles[1].canReview = 1;
    expect(validateClient(files).map((e) => e.path)).toEqual(["/roles/0", "/roles/1/canReview"]);
  });

  it("角色的 canUpload 必填，只接受 boolean", () => {
    const files = example();
    delete files["access.json"].roles[0].canUpload;
    files["access.json"].roles[1].canUpload = "yes";
    expect(validateClient(files).map((e) => e.path)).toEqual(["/roles/0", "/roles/1/canUpload"]);
  });

  it("情境的角色與問題 id 會被檢查", () => {
    const files = example();
    const scenario = files["scenarios.json"].scenarios[0];
    scenario.role = "director";
    const q = scenario.questions.push({ id: "people-manager", text: { "zh-TW": "重複" }, answerPassages: ["employee-handbook-zh-04"] }) - 1;
    scenario.questions[q].id = scenario.questions[0].id;
    expect(validateClient(files)).toEqual([
      { file: "scenarios.json", path: `/scenarios/0/questions/${q}/id`, message: `id ${scenario.questions[0].id} 重複` },
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
    // 主題（色票、圓角、字體）
    expect(schema("theme.schema.json").required).toEqual(["colors", "radius", "fonts"]);
  });
});

describe("翻譯檔", () => {
  const check = (data, files = example()) => validateClient(files, undefined, data);

  it("client/i18n/ 的範例翻譯檔通過驗證", () => {
    expect(check(i18n())).toEqual([]);
  });

  it("缺少語言的翻譯檔、不在 languages 內的翻譯檔都會失敗", () => {
    const data = i18n();
    delete data.en;
    data.fr = structuredClone(data["zh-TW"]);
    expect(check(data)).toEqual([
      { file: "i18n/en.json", path: "/", message: "缺少翻譯檔" },
      { file: "i18n/fr.json", path: "/", message: "語言 fr 不在 client.json 的 languages 內" },
    ]);
  });

  it("鍵必須完全一致：缺少或多出來的鍵（含巢狀物件）都會失敗", () => {
    const data = i18n();
    delete data.en.loading;
    data.en.logo = "Logo";
    delete data["zh-TW"].errors.daily_limit;
    data["zh-TW"].uploadErrors.extra = "多出來的";
    expect(check(data)).toEqual(
      expect.arrayContaining([
        { file: "i18n/en.json", path: "/", message: "缺少必填欄位 loading" },
        { file: "i18n/en.json", path: "/", message: "不允許的欄位 logo" },
        { file: "i18n/zh-TW.json", path: "/errors", message: "缺少必填欄位 daily_limit" },
        { file: "i18n/zh-TW.json", path: "/uploadErrors", message: "不允許的欄位 extra" },
      ]),
    );
  });

  it("空字串或只有空白的文字會失敗", () => {
    const data = i18n();
    data.en.loading = " ";
    expect(check(data).map((e) => `${e.file} ${e.path}`)).toEqual(["i18n/en.json /loading"]);
  });

  it("帶參數的文字在各語言中的參數必須相同", () => {
    const data = i18n();
    data.en.reviewToastApproved = "Approved";
    data.en.conflictMarks.conflict = "Differs from {name}";
    data.en.progress = "{done} of {total} ({done})";
    expect(check(data)).toEqual([
      { file: "i18n/en.json", path: "/reviewToastApproved", message: "參數 （無） 與 zh-TW 的 {count} 不同" },
      { file: "i18n/en.json", path: "/conflictMarks/conflict", message: "參數 {name} 與 zh-TW 的 {title} 不同" },
    ]);
  });

  it("預設語言的翻譯檔有誤時，以其他語言為準比對參數", () => {
    const data = i18n();
    delete data["zh-TW"].loading;
    data.en.conflictToast = "Marked";
    const files = example();
    files["client.json"].languages = ["zh-TW", "en", "ja"];
    data.ja = structuredClone(data.en);
    data.ja.conflictToast = "{name}";
    expect(check(data, files)).toEqual([
      { file: "i18n/zh-TW.json", path: "/", message: "缺少必填欄位 loading" },
      { file: "i18n/ja.json", path: "/conflictToast", message: "參數 {name} 與 en 的 （無） 不同" },
    ]);
  });

  it("故意寫錯的翻譯檔會失敗", () => {
    const errors = checkClient(new URL("./fixtures/invalid-client/", import.meta.url)).filter((e) => e.file.startsWith(I18N_DIR));
    expect(errors).toEqual(
      expect.arrayContaining([
        { file: "i18n/zh-TW.json", path: "/", message: "缺少翻譯檔" },
        { file: "i18n/fr.json", path: "/", message: "語言 fr 不在 client.json 的 languages 內" },
        { file: "i18n/en.json", path: "/", message: "不允許的欄位 logo" },
        { file: "i18n/en.json", path: "/", message: "缺少必填欄位 loadFailed" },
      ]),
    );
  });
});

describe("資料集", () => {
  const check = (data) => validateClient(example(), data);

  it("client/data/ 的範例資料通過 Schema", () => {
    expect(check(dataset())).toEqual([]);
  });

  it("dataset.path 或 evals.path 不存在時失敗", () => {
    const errors = checkClient(new URL("./fixtures/invalid-client/", import.meta.url));
    expect(errors).toContainEqual({ file: "client.json", path: "/evals/path", message: "資料夾 evals/ 不存在" });
  });

  it("缺少資料檔、沒有文件、未知的資料檔都會失敗", () => {
    const data = dataset();
    delete data.files["relations.json"];
    delete data.files[DOC];
    data.files["notes.json"] = {};
    expect(check(data)).toEqual([
      { file: "data/relations.json", path: "/", message: "缺少資料檔" },
      { file: "data/documents/", path: "/", message: "至少要有一份文件" },
      { file: "data/notes.json", path: "/", message: "未知的資料檔" },
    ]);
  });

  it("文件的錯誤指出檔名與欄位", () => {
    const data = dataset();
    const doc = data.files[DOC];
    doc.date = "2026-13-01";
    delete doc.title;
    doc.passages[1].visibility = "Secret";
    doc.passages[2].note = "x";
    expect(check(data)).toEqual([
      { file: `data/${DOC}`, path: "/", message: "缺少必填欄位 title" },
      { file: `data/${DOC}`, path: "/date", message: expect.stringContaining("must match pattern") },
      { file: `data/${DOC}`, path: "/passages/1/visibility", message: expect.stringContaining("must match pattern") },
      { file: `data/${DOC}`, path: "/passages/2", message: "不允許的欄位 note" },
    ]);
  });

  it("實體與關係至少要有一個出處", () => {
    const data = dataset();
    data.files["entities.json"].entities[0].sources = [];
    delete data.files["relations.json"].relations[0].sources;
    expect(check(data)).toEqual([
      { file: "data/entities.json", path: "/entities/0/sources", message: "must NOT have fewer than 1 items" },
      { file: "data/relations.json", path: "/relations/0", message: "缺少必填欄位 sources" },
    ]);
  });
});
