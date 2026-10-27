// 以 client/schema/ 的 JSON Schema 驗證 client/ 的設定與資料集，再檢查跨檔規則。
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
const DOCUMENT_PATH = /^documents\/[^/]+\.json$/;

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

function loadSchemas() {
  return ["", "data/"].flatMap((sub) =>
    readdirSync(new URL(sub, SCHEMA_DIR))
      .filter((name) => name.endsWith(".schema.json"))
      .map((name) => readJson(new URL(`${sub}${name}`, SCHEMA_DIR))),
  );
}

const RELATIVE_PATH = new RegExp(readJson(new URL("common.schema.json", SCHEMA_DIR)).definitions.RelativePath.pattern);

// files：{ 設定檔名: 解析後的 JSON }。
// dataset：{ root: dataset.path, files: { 相對於 root 的路徑: 解析後的 JSON } }；省略時不驗證資料集。
// 回傳 [{ file, path, message }]，沒有錯誤時為空陣列。
export function validateClient(files, dataset) {
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
  return [...errors, ...checkReferences(valid)];
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

function describe(e) {
  if (e.keyword === "additionalProperties") return `不允許的欄位 ${e.params.additionalProperty}`;
  if (e.keyword === "required") return `缺少必填欄位 ${e.params.missingProperty}`;
  return e.message;
}

// 讀取資料夾中所有頂層 .json 檔與資料集再驗證；dataset.path、evals.path 必須存在。
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

  let dataset;
  if (paths.dataset) {
    const root = paths.dataset;
    dataset = { root, files: {} };
    for (const rel of readdirSync(new URL(root, base), { recursive: true })) {
      if (rel.endsWith(".json")) read(new URL(`${root}${rel}`, base), `${root}${rel}`, dataset.files, rel);
    }
  }
  return [...errors, ...validateClient(files, dataset)];
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
