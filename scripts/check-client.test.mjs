import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFIG_FILES, DATASET_FILES, EVALS_FILES, I18N_DIR, checkClient, contrast, mix, validateClient } from "./check-client.mjs";

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
        "theme.json /darkColors",
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
    expect(errors).toContainEqual({ file: "theme.json", path: "/darkColors", message: "缺少必填欄位 graphFallback" });
    expect(errors).toContainEqual({ file: "access.json", path: "/roles/0/projects/1", message: "專案 unknown 不存在" });
  });

  it("對比度的算法：WCAG 2.x 的相對亮度，color-mix 在 sRGB 數值上內插", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
    expect(contrast("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
    expect(mix("#000000", 14, "#FFFFFF")).toBe("#dbdbdb");
    expect(mix("#B42318", 100, "#FFFFFF")).toBe("#b42318");
  });

  it("淺色與深色的文字對比不足 4.5:1 時失敗，指出配色、欄位與背景", () => {
    const files = example();
    files["theme.json"].darkColors.textMuted = "#555555";
    files["theme.json"].colors.onStatus = "#B0B0B0";
    const errors = validateClient(files);
    expect(errors).toContainEqual({ file: "theme.json", path: "/darkColors/textMuted", message: "與 surface 的對比 2.1:1，需要 4.5:1" });
    expect(errors.map((e) => e.path)).toContain("/colors/onStatus");
    expect(errors.every((e) => e.file === "theme.json")).toBe(true);
  });

  it("淡色底色（提示框、標示）也檢查對比", () => {
    const files = example();
    files["theme.json"].darkColors.mark = "#9A8A40";
    const errors = validateClient(files);
    expect(errors.map((e) => `${e.path} ${e.message.split(" 的對比")[0]}`)).toEqual(["/darkColors/text 與 mark"]);
  });

  it("可見等級與實體類型的顏色在任一配色下不足時，指出是哪一個、對哪組背景", () => {
    const files = example();
    // 等級標籤的淡色底只有 14%，一般文字色夠深就不會不足；這裡讓深色的 text 變暗來觸發
    files["theme.json"].darkColors.text = "#6E7681";
    files["knowledge-model.json"].entityTypes[0].color = "#2F5D8A";
    const errors = validateClient(files).filter((e) => e.file !== "theme.json");
    expect(errors).toEqual([
      ...["public", "internal", "confidential"].map((id, i) => ({
        file: "access.json",
        path: `/visibilityLevels/${i}/color`,
        message: expect.stringMatching(new RegExp(`^「.+」（${id}）的標籤底色與 darkColors 的 text 對比 [\\d.]+:1，需要 4\\.5:1$`)),
      })),
      { file: "knowledge-model.json", path: "/entityTypes/0/color", message: "「人員」（person）與 darkColors 的 background 對比 2.5:1，需要 3:1" },
      { file: "knowledge-model.json", path: "/entityTypes/0/color", message: "「人員」（person）與 darkColors 的 surface 對比 2.2:1，需要 3:1" },
      // 選取的節點：圖示改用 text，放在類型色 14% 的淡色底上
      ...[["部門", "team", 1], ["專案", "project", 2]].map(([name, id, i]) => ({
        file: "knowledge-model.json",
        path: `/entityTypes/${i}/color`,
        message: `「${name}」（${id}）的選取底色（14% + surface）與 darkColors 的 text 對比 2.9:1，需要 3:1`,
      })),
    ]);
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
    for (const provider of ["keyword-hash", "multilingual-e5-small"]) {
      files["client.json"].retrieval = { provider };
      expect(validateClient(files), provider).toEqual([]);
    }
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

  it("實體類型的圖示只接受固定圖示集，省略時預設 generic", () => {
    const files = example();
    files["knowledge-model.json"].entityTypes[0].icon = "rocket";
    delete files["knowledge-model.json"].entityTypes[1].icon;
    expect(validateClient(files).map((e) => e.path)).toEqual(["/entityTypes/0/icon"]);
    expect(schema("knowledge-model.schema.json").properties.entityTypes.items.properties.icon.default).toBe("generic");
  });

  it("同一個客戶內實體類型的圖示不重複，generic（含省略）除外", () => {
    const files = example();
    const types = files["knowledge-model.json"].entityTypes;
    types[1].icon = types[0].icon;
    expect(validateClient(files)).toEqual([
      { file: "knowledge-model.json", path: "/entityTypes/1/icon", message: `icon ${types[0].icon} 重複` },
    ]);
    types[0].icon = "generic";
    delete types[1].icon;
    delete types[2].icon;
    expect(validateClient(files)).toEqual([]);
  });

  it("client/ 與 clients/ 的每種實體類型都設定了圖示（不是 generic）", () => {
    const root = new URL("../", import.meta.url);
    const dirs = ["client/", ...readdirSync(new URL("clients/", root), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `clients/${d.name}/`)];
    expect(dirs.length).toBeGreaterThan(1);
    for (const dir of dirs) {
      const model = readJson(new URL(`${dir}knowledge-model.json`, root));
      const generic = model.entityTypes.filter((t) => (t.icon ?? "generic") === "generic").map((t) => `${dir} ${t.id}`);
      expect(generic).toEqual([]);
    }
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
    // 主題（色票（淺色與深色）、圓角、字體）
    expect(schema("theme.schema.json").required).toEqual(["colors", "darkColors", "radius", "fonts"]);
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

describe("評測題庫", () => {
  const evals = () => ({
    root: "evals/",
    files: Object.fromEntries(Object.keys(EVALS_FILES).map((f) => [f, readJson(new URL(`../client/evals/${f}`, import.meta.url))])),
  });
  const check = (data, files = example()) => validateClient(files, undefined, undefined, data);
  const FILE = "evals/questions.json";

  it("client/evals/ 的範例題庫通過驗證", () => {
    expect(check(evals())).toEqual([]);
  });

  it("缺少題庫檔、未知的題庫檔都會失敗", () => {
    const data = evals();
    delete data.files["questions.json"];
    data.files["notes.json"] = {};
    expect(check(data)).toEqual([
      { file: FILE, path: "/", message: "缺少題庫檔" },
      { file: "evals/notes.json", path: "/", message: "未知的題庫檔" },
    ]);
  });

  it("Schema：缺欄位、多餘欄位、列舉值、空的同義說法都會失敗", () => {
    const data = evals();
    const [q0, q1, q2, q3] = data.files["questions.json"].questions;
    delete q0.referenceAnswer;
    q1.note = "x";
    q2.category = "other";
    q3.keyPoints = [[]];
    expect(check(data)).toEqual([
      { file: FILE, path: "/questions/0", message: "缺少必填欄位 referenceAnswer" },
      { file: FILE, path: "/questions/1", message: "不允許的欄位 note" },
      { file: FILE, path: "/questions/2/category", message: expect.stringContaining("allowed values") },
      { file: FILE, path: "/questions/3/keyPoints/0", message: "must NOT have fewer than 1 items" },
    ]);
  });

  it("題目 id 不重複，角色與語言必須存在於 client/ 設定", () => {
    const data = evals();
    const questions = data.files["questions.json"].questions;
    questions[1].id = questions[0].id;
    questions[2].role = "director";
    questions[3].language = "ja";
    expect(check(data)).toEqual([
      { file: FILE, path: "/questions/1/id", message: `id ${questions[0].id} 重複` },
      { file: FILE, path: "/questions/2/role", message: "角色 director 不存在" },
      { file: FILE, path: "/questions/3/language", message: "語言 ja 不在 client.json 的 languages 內" },
    ]);
  });

  it("passageLanguage 必須在 languages 內；跨語言題必須指定與 language 不同的 passageLanguage", () => {
    const data = evals();
    const questions = data.files["questions.json"].questions;
    const cross = questions.filter((q) => q.category === "cross-language");
    expect(cross.length).toBeGreaterThan(1);
    const [i, j] = [questions.indexOf(cross[0]), questions.indexOf(cross[1])];
    questions[0].passageLanguage = "ja";
    delete questions[i].passageLanguage;
    questions[j].passageLanguage = questions[j].language;
    expect(check(data)).toEqual([
      { file: FILE, path: "/questions/0/passageLanguage", message: "語言 ja 不在 client.json 的 languages 內" },
      { file: FILE, path: `/questions/${i}/passageLanguage`, message: "跨語言題必須指定與 language 不同的 passageLanguage" },
      { file: FILE, path: `/questions/${j}/passageLanguage`, message: "跨語言題必須指定與 language 不同的 passageLanguage" },
    ]);
  });

  it("預期回答要有答案段落、關鍵重點與參考答案；預期拒答不能有關鍵重點，參考答案為 null", () => {
    const data = evals();
    const questions = data.files["questions.json"].questions;
    const answer = questions.findIndex((q) => q.expect === "answer");
    const refusal = questions.findIndex((q) => q.expect === "refusal");
    Object.assign(questions[answer], { answerPassages: [], keyPoints: [], referenceAnswer: null });
    Object.assign(questions[refusal], { keyPoints: [["x"]], referenceAnswer: "x" });
    expect(check(data)).toEqual([
      { file: FILE, path: `/questions/${answer}/answerPassages`, message: "預期回答時至少要有一個答案段落" },
      { file: FILE, path: `/questions/${answer}/keyPoints`, message: "預期回答時至少要有一項關鍵重點" },
      { file: FILE, path: `/questions/${answer}/referenceAnswer`, message: "預期回答時必須有參考答案" },
      { file: FILE, path: `/questions/${refusal}/keyPoints`, message: "預期拒答時不能有關鍵重點" },
      { file: FILE, path: `/questions/${refusal}/referenceAnswer`, message: "預期拒答時參考答案必須是 null" },
    ]);
  });

  it("門檻：比例為 0～1，可省略；權限滲漏固定是 0，寫了 leakage 就失敗", () => {
    const files = example();
    files["client.json"].evals.thresholds = { citation: 1.5 };
    expect(validateClient(files).map((e) => e.path)).toEqual(["/evals/thresholds/citation"]);
    for (const leakage of [0, 1]) {
      files["client.json"].evals.thresholds = { leakage };
      expect(validateClient(files)).toEqual([expect.objectContaining({ path: "/evals/thresholds", message: "不允許的欄位 leakage" })]);
    }
    delete files["client.json"].evals.thresholds;
    expect(validateClient(files)).toEqual([]);
  });

  it("checkClient 讀入 evals.path 的題庫", () => {
    const dir = mkdtempSync(join(tmpdir(), "kk-client-"));
    try {
      cpSync(fileURLToPath(new URL("../client/", import.meta.url)), dir, { recursive: true });
      writeFileSync(join(dir, "evals", "questions.json"), "{");
      writeFileSync(join(dir, "evals", "extra.json"), "{}");
      expect(checkClient(pathToFileURL(`${dir}/`))).toEqual([
        { file: "evals/questions.json", path: "/", message: expect.stringContaining("JSON 格式錯誤") },
        { file: "evals/questions.json", path: "/", message: "缺少題庫檔" },
        { file: "evals/extra.json", path: "/", message: "未知的題庫檔" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("沒有給資料夾時依 KK_CLIENT 選擇，資料夾不存在時以非 0 結束並說明原因", () => {
    const script = fileURLToPath(new URL("./check-client.mjs", import.meta.url));
    const run = (KK_CLIENT) => spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, KK_CLIENT } });
    const missing = run("nope");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("KK_CLIENT=nope：找不到 clients/nope/client.json");
    const reference = run("");
    expect(reference.status).toBe(0);
    expect(reference.stdout).toContain(fileURLToPath(new URL("../client/", import.meta.url)));
  });
});
