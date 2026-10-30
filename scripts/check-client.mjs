// 以 client/schema/ 的 JSON Schema 驗證 client/ 的設定、翻譯檔、資料集與評測題庫，再檢查跨檔規則。
// 用法：node scripts/check-client.mjs [設定資料夾，預設 client/]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv from "ajv";

const SCHEMA_DIR = new URL("../client/schema/", import.meta.url);
const DEFAULT_CLIENT_DIR = new URL("../client/", import.meta.url);

// 設定檔名 → Schema 檔名
export const CONFIG_FILES = {
  "client.json": "client.schema.json",
  "theme.json": "theme.schema.json",
  "knowledge-model.json": "knowledge-model.schema.json",
  "access.json": "access.schema.json",
  "scenarios.json": "scenarios.schema.json",
};

// 資料集（client.json 的 dataset.path）內的檔名 → Schema；documents/*.json 一律用 DOCUMENT_SCHEMA
export const DATASET_FILES = {
  "entities.json": "data/entities.schema.json",
  "relations.json": "data/relations.schema.json",
};
const DOCUMENT_SCHEMA = "data/document.schema.json";

// 評測題庫（client.json 的 evals.path）內的檔名 → Schema（docs/evals.md）
export const EVALS_FILES = {
  "questions.json": "evals/questions.schema.json",
};

// 翻譯檔：client/i18n/<語言>.json，每種語言一份（docs/client-config.md「翻譯檔」）
export const I18N_DIR = "i18n/";
const I18N_SCHEMA = "i18n.schema.json";
// 帶參數文字的參數：{camelCase}
const PARAM = /\{([A-Za-z]+)\}/g;
const DOCUMENT_PATH = /^documents\/[^/]+\.json$/;

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

function loadSchemas() {
  return ["", "data/", "evals/"].flatMap((sub) =>
    readdirSync(new URL(sub, SCHEMA_DIR))
      .filter((name) => name.endsWith(".schema.json"))
      .map((name) => readJson(new URL(`${sub}${name}`, SCHEMA_DIR))),
  );
}

const RELATIVE_PATH = new RegExp(readJson(new URL("common.schema.json", SCHEMA_DIR)).definitions.RelativePath.pattern);

// files：{ 設定檔名: 解析後的 JSON }。
// dataset：{ root: dataset.path, files: { 相對於 root 的路徑: 解析後的 JSON } }；省略時不驗證資料集。
// i18n：{ 語言代碼: 解析後的 JSON }（client/i18n/ 的檔名去掉 .json）；省略時不驗證翻譯檔。
// evals：{ root: evals.path, files: { 相對於 root 的路徑: 解析後的 JSON } }；省略時不驗證評測題庫。
// 回傳 [{ file, path, message }]，沒有錯誤時為空陣列。
export function validateClient(files, dataset, i18n, evals) {
  const errors = [];
  const client = files["client.json"];
  const languages = Array.isArray(client?.languages) ? client.languages : null;
  const defaultLanguage = typeof client?.defaultLanguage === "string" ? client.defaultLanguage : null;

  const ajv = new Ajv({ allErrors: true, strict: true });
  ajv.addKeyword({
    keyword: "localizedText",
    type: "object",
    schemaType: "boolean",
    errors: true,
    validate: function localizedText(_schema, data) {
      // languages 本身有誤時由 client.schema.json 報錯，這裡不重複
      if (!languages) return true;
      const problems = [];
      for (const key of Object.keys(data)) {
        if (!languages.includes(key)) problems.push(`語言 ${key} 不在 client.json 的 languages 內`);
      }
      if (defaultLanguage && languages.includes(defaultLanguage) && !(defaultLanguage in data)) {
        problems.push(`缺少預設語言 ${defaultLanguage}`);
      }
      localizedText.errors = problems.map((message) => ({ keyword: "localizedText", message }));
      return problems.length === 0;
    },
  });
  for (const schema of loadSchemas()) ajv.addSchema(schema);

  // 通過 Schema 的檔才做參照檢查，避免在形狀不對的資料上誤判
  const valid = {};
  for (const [file, schemaId] of Object.entries(CONFIG_FILES)) {
    if (!(file in files)) {
      errors.push({ file, path: "/", message: "缺少設定檔" });
      continue;
    }
    const validate = ajv.getSchema(schemaId);
    if (validate(files[file])) {
      valid[file] = files[file];
    } else {
      for (const e of validate.errors) {
        errors.push({ file, path: e.instancePath || "/", message: describe(e) });
      }
    }
  }
  for (const file of Object.keys(files)) {
    if (!(file in CONFIG_FILES)) errors.push({ file, path: "/", message: "未知的設定檔" });
  }

  if (languages && defaultLanguage && !languages.includes(defaultLanguage)) {
    errors.push({ file: "client.json", path: "/defaultLanguage", message: `${defaultLanguage} 不在 languages 內` });
  }
  if (dataset) errors.push(...validateDataset(ajv, dataset));
  if (i18n && languages) errors.push(...validateI18n(ajv, i18n, languages, defaultLanguage));
  if (evals) errors.push(...validateEvals(ajv, evals, valid));
  return [...errors, ...checkReferences(valid), ...checkContrast(valid)];
}

// 資料集只驗證 Schema；語言、類型、可見等級等跨檔規則由匯入程式檢查（docs/dataset.md）。
function validateDataset(ajv, { root, files }) {
  const errors = [];
  const label = (rel) => `${root}${rel}`;
  const check = (rel, schemaId) => {
    const validate = ajv.getSchema(schemaId);
    if (!validate(files[rel])) {
      for (const e of validate.errors) errors.push({ file: label(rel), path: e.instancePath || "/", message: describe(e) });
    }
  };
  for (const [rel, schemaId] of Object.entries(DATASET_FILES)) {
    if (rel in files) check(rel, schemaId);
    else errors.push({ file: label(rel), path: "/", message: "缺少資料檔" });
  }
  const documents = Object.keys(files).filter((rel) => DOCUMENT_PATH.test(rel));
  if (documents.length === 0) errors.push({ file: label("documents/"), path: "/", message: "至少要有一份文件" });
  for (const rel of documents) check(rel, DOCUMENT_SCHEMA);
  for (const rel of Object.keys(files)) {
    if (!(rel in DATASET_FILES) && !DOCUMENT_PATH.test(rel)) errors.push({ file: label(rel), path: "/", message: "未知的資料檔" });
  }
  return errors;
}

// 評測題庫：Schema，以及只需 client/ 設定的規則。答案段落是否存在、角色看不看得到需要資料集與 oracle，
// 由 app/src/evals/validate.ts 檢查（比照資料集，docs/evals.md「檢查」）。
function validateEvals(ajv, { root, files }, valid) {
  const errors = [];
  const label = (rel) => `${root}${rel}`;
  const ok = {};
  for (const [rel, schemaId] of Object.entries(EVALS_FILES)) {
    if (!(rel in files)) {
      errors.push({ file: label(rel), path: "/", message: "缺少題庫檔" });
      continue;
    }
    const validate = ajv.getSchema(schemaId);
    if (validate(files[rel])) ok[rel] = files[rel];
    else for (const e of validate.errors) errors.push({ file: label(rel), path: e.instancePath || "/", message: describe(e) });
  }
  for (const rel of Object.keys(files)) {
    if (!(rel in EVALS_FILES)) errors.push({ file: label(rel), path: "/", message: "未知的題庫檔" });
  }

  const questions = ok["questions.json"]?.questions;
  if (!questions) return errors;
  const file = label("questions.json");
  const roles = valid["access.json"] && new Set(valid["access.json"].roles.map((r) => r.id));
  const languages = valid["client.json"]?.languages;
  const seen = new Set();
  questions.forEach((q, i) => {
    const at = `/questions/${i}`;
    if (seen.has(q.id)) errors.push({ file, path: `${at}/id`, message: `id ${q.id} 重複` });
    seen.add(q.id);
    if (roles && !roles.has(q.role)) errors.push({ file, path: `${at}/role`, message: `角色 ${q.role} 不存在` });
    if (languages && !languages.includes(q.language)) {
      errors.push({ file, path: `${at}/language`, message: `語言 ${q.language} 不在 client.json 的 languages 內` });
    }
    if (q.expect === "answer") {
      if (q.answerPassages.length === 0) errors.push({ file, path: `${at}/answerPassages`, message: "預期回答時至少要有一個答案段落" });
      if (q.keyPoints.length === 0) errors.push({ file, path: `${at}/keyPoints`, message: "預期回答時至少要有一項關鍵重點" });
      if (q.referenceAnswer === null) errors.push({ file, path: `${at}/referenceAnswer`, message: "預期回答時必須有參考答案" });
    } else {
      if (q.keyPoints.length > 0) errors.push({ file, path: `${at}/keyPoints`, message: "預期拒答時不能有關鍵重點" });
      if (q.referenceAnswer !== null) errors.push({ file, path: `${at}/referenceAnswer`, message: "預期拒答時參考答案必須是 null" });
    }
  });
  return errors;
}

// 翻譯檔：languages 的每一種都要有，不能多；鍵由 i18n.schema.json 檢查（全部必填、不允許多餘的鍵）；
// 通過 Schema 的檔再比對每個鍵的參數，以預設語言（沒有通過時用第一個通過的語言）為準。
function validateI18n(ajv, i18n, languages, defaultLanguage) {
  const errors = [];
  const label = (language) => `${I18N_DIR}${language}.json`;
  const validate = ajv.getSchema(I18N_SCHEMA);
  const valid = [];
  for (const language of languages) {
    if (!(language in i18n)) errors.push({ file: label(language), path: "/", message: "缺少翻譯檔" });
  }
  for (const [language, data] of Object.entries(i18n)) {
    if (!languages.includes(language)) {
      errors.push({ file: label(language), path: "/", message: `語言 ${language} 不在 client.json 的 languages 內` });
    } else if (validate(data)) {
      valid.push(language);
    } else {
      for (const e of validate.errors) errors.push({ file: label(language), path: e.instancePath || "/", message: describe(e) });
    }
  }
  const base = valid.includes(defaultLanguage) ? defaultLanguage : valid[0];
  const params = (text) => [...new Set([...text.matchAll(PARAM)].map((m) => `{${m[1]}}`))].sort();
  const show = (list) => (list.length > 0 ? list.join("、") : "（無）");
  const texts = (data, path = "") =>
    Object.entries(data).flatMap(([k, v]) => (typeof v === "string" ? [[`${path}/${k}`, v]] : texts(v, `${path}/${k}`)));
  const expected = base ? Object.fromEntries(texts(i18n[base])) : {};
  for (const language of valid.filter((l) => l !== base)) {
    for (const [path, text] of texts(i18n[language])) {
      const want = params(expected[path]);
      const got = params(text);
      if (want.join() !== got.join()) {
        errors.push({ file: label(language), path, message: `參數 ${show(got)} 與 ${base} 的 ${show(want)} 不同` });
      }
    }
  }
  return errors;
}

// 跨檔規則：同一清單內 id 不重複、可見等級的 rank 不重複、參照的 id 必須存在。
function checkReferences(valid) {
  const errors = [];
  const unique = (file, path, items, key = "id") => {
    const seen = new Set();
    items.forEach((item, i) => {
      if (seen.has(item[key])) errors.push({ file, path: `${path}/${i}/${key}`, message: `${key} ${item[key]} 重複` });
      seen.add(item[key]);
    });
  };
  const exists = (file, path, ids, known, what) => {
    if (!known) return; // 被參照的檔本身有誤時，錯誤已由 Schema 回報
    ids.forEach((id, i) => {
      if (!known.has(id)) errors.push({ file, path: `${path}/${i}`, message: `${what} ${id} 不存在` });
    });
  };
  const ids = (items) => new Set(items.map((item) => item.id));

  const model = valid["knowledge-model.json"];
  const access = valid["access.json"];
  const scenarios = valid["scenarios.json"];

  if (model) {
    const file = "knowledge-model.json";
    unique(file, "/entityTypes", model.entityTypes);
    unique(file, "/relationTypes", model.relationTypes);
    const entityTypes = ids(model.entityTypes);
    model.relationTypes.forEach((rel, i) => {
      exists(file, `/relationTypes/${i}/from`, rel.from, entityTypes, "實體類型");
      exists(file, `/relationTypes/${i}/to`, rel.to, entityTypes, "實體類型");
    });
  }
  if (access) {
    const file = "access.json";
    unique(file, "/visibilityLevels", access.visibilityLevels);
    unique(file, "/visibilityLevels", access.visibilityLevels, "rank");
    unique(file, "/projects", access.projects);
    unique(file, "/roles", access.roles);
    const levels = ids(access.visibilityLevels);
    const projects = ids(access.projects);
    access.roles.forEach((role, i) => {
      if (!levels.has(role.visibility)) {
        errors.push({ file, path: `/roles/${i}/visibility`, message: `可見等級 ${role.visibility} 不存在` });
      }
      exists(file, `/roles/${i}/projects`, role.projects, projects, "專案");
    });
  }
  if (scenarios) {
    const file = "scenarios.json";
    unique(file, "/scenarios", scenarios.scenarios);
    const roles = access && ids(access.roles);
    scenarios.scenarios.forEach((s, i) => {
      unique(file, `/scenarios/${i}/questions`, s.questions);
      if (roles && !roles.has(s.role)) {
        errors.push({ file, path: `/scenarios/${i}/role`, message: `角色 ${s.role} 不存在` });
      }
    });
  }
  return errors;
}

// 對比度（WCAG 2.x）：文字 4.5:1（AA 一般文字），實體類型的節點顏色 3:1（1.4.11 非文字）。
// 淺色（colors）與深色（darkColors）各檢查一次；淡色底色依 app.css 的 color-mix(in srgb, …) 比例算出。
// 組合見 docs/client-config.md「對比度」。
export const TEXT_CONTRAST = 4.5;
export const GRAPHIC_CONTRAST = 3;
const SCHEMES = ["colors", "darkColors"];
const STATUS = ["danger", "warning", "success", "info"];
// app.css 的淡色比例：提示框與可見等級標籤 14%，選取中的項目 12%
const TINT = 14;
const SELECTED_TINT = 12;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// color-mix(in srgb, a p%, b)：在 sRGB 數值上線性內插
export function mix(a, percent, b) {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round((v * percent + y[i] * (100 - percent)) / 100).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// 無條件捨去到小數一位，避免 4.46 顯示成 4.5:1 卻不通過
const ratio = (value) => `${Math.floor(value * 10) / 10}:1`;

function checkContrast(valid) {
  const theme = valid["theme.json"];
  if (!theme) return [];
  const errors = [];
  const label = (level) => `「${level.label[valid["client.json"]?.defaultLanguage] ?? level.id}」（${level.id}）`;
  for (const scheme of SCHEMES) {
    const c = theme[scheme];
    // [前景鍵, 背景名稱, 背景色]
    const pairs = [
      ...["text", "textMuted"].flatMap((fg) => ["background", "surface"].map((bg) => [fg, bg, c[bg]])),
      ["primary", "surface", c.surface],
      ["primary", "background", c.background],
      ["onPrimary", "primary", c.primary],
      ...STATUS.flatMap((s) => {
        const tint = [`${s} ${TINT}% + surface`, mix(c[s], TINT, c.surface)];
        return [
          [s, "surface", c.surface],
          [s, "background", c.background],
          [s, ...tint],
          ["text", ...tint],
          ["onStatus", s, c[s]],
        ];
      }),
      ["text", "mark", c.mark],
      ["text", `primary ${SELECTED_TINT}% + surface`, mix(c.primary, SELECTED_TINT, c.surface)],
    ];
    for (const [fg, bg, color] of pairs) {
      const value = contrast(c[fg], color);
      if (value < TEXT_CONTRAST) {
        errors.push({ file: "theme.json", path: `/${scheme}/${fg}`, message: `與 ${bg} 的對比 ${ratio(value)}，需要 ${TEXT_CONTRAST}:1` });
      }
    }

    // 可見等級標籤：一般文字色放在等級色的淡色底上
    valid["access.json"]?.visibilityLevels.forEach((level, i) => {
      const value = contrast(c.text, mix(level.color, TINT, c.surface));
      if (value < TEXT_CONTRAST) {
        errors.push({
          file: "access.json",
          path: `/visibilityLevels/${i}/color`,
          message: `${label(level)}的標籤底色與 ${scheme} 的 text 對比 ${ratio(value)}，需要 ${TEXT_CONTRAST}:1`,
        });
      }
    });
    // 圖譜的節點：實體類型的顏色放在頁面或面板的背景上
    valid["knowledge-model.json"]?.entityTypes.forEach((type, i) => {
      for (const bg of ["background", "surface"]) {
        const value = contrast(type.color, c[bg]);
        if (value < GRAPHIC_CONTRAST) {
          errors.push({
            file: "knowledge-model.json",
            path: `/entityTypes/${i}/color`,
            message: `${label(type)}與 ${scheme} 的 ${bg} 對比 ${ratio(value)}，需要 ${GRAPHIC_CONTRAST}:1`,
          });
        }
      }
    });
  }
  return errors;
}

function describe(e) {
  if (e.keyword === "additionalProperties") return `不允許的欄位 ${e.params.additionalProperty}`;
  if (e.keyword === "required") return `缺少必填欄位 ${e.params.missingProperty}`;
  return e.message;
}

// 讀取資料夾中所有頂層 .json 檔、翻譯檔、資料集與評測題庫再驗證；dataset.path、evals.path 必須存在。
export function checkClient(dir = DEFAULT_CLIENT_DIR) {
  const base = new URL(dir.toString().endsWith("/") ? dir : `${dir}/`);
  const files = {};
  const errors = [];
  const read = (url, file, into, key) => {
    try {
      into[key] = readJson(url);
    } catch (err) {
      errors.push({ file, path: "/", message: `JSON 格式錯誤：${err.message}` });
    }
  };
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) read(new URL(entry.name, base), entry.name, files, entry.name);
  }

  const paths = {};
  for (const key of ["dataset", "evals"]) {
    const value = files["client.json"]?.[key]?.path;
    // 格式不對時由 Schema 回報
    if (typeof value !== "string" || !RELATIVE_PATH.test(value)) continue;
    const root = value.endsWith("/") ? value : `${value}/`;
    if (existsSync(new URL(root, base)) && statSync(new URL(root, base)).isDirectory()) paths[key] = root;
    else errors.push({ file: "client.json", path: `/${key}/path`, message: `資料夾 ${value} 不存在` });
  }

  const i18n = {};
  const i18nDir = new URL(I18N_DIR, base);
  if (existsSync(i18nDir) && statSync(i18nDir).isDirectory()) {
    for (const entry of readdirSync(i18nDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        read(new URL(entry.name, i18nDir), `${I18N_DIR}${entry.name}`, i18n, entry.name.slice(0, -".json".length));
      }
    }
  }

  const [dataset, evals] = ["dataset", "evals"].map((key) => {
    const root = paths[key];
    if (!root) return undefined;
    const out = { root, files: {} };
    for (const rel of readdirSync(new URL(root, base), { recursive: true })) {
      if (rel.endsWith(".json")) read(new URL(`${root}${rel}`, base), `${root}${rel}`, out.files, rel);
    }
    return out;
  });
  return [...errors, ...validateClient(files, dataset, i18n, evals)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  const dir = arg ? pathToFileURL(`${arg.replace(/\/?$/, "/")}`) : DEFAULT_CLIENT_DIR;
  const errors = checkClient(dir);
  for (const e of errors) console.error(`${e.file} ${e.path}：${e.message}`);
  if (errors.length > 0) {
    console.error(`client 設定檢查失敗：${errors.length} 個錯誤`);
    process.exit(1);
  }
  console.log(`client 設定檢查通過：${fileURLToPath(dir)}`);
}
