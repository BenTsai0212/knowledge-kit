// 敏感資料檢查：掃描 git ls-files 列出的檔案，找出個人 email 與禁用名稱（#66，見 docs/testing.md）。
// 用法：node scripts/check-sensitive.mjs [repo 根目錄，預設目前目錄]
// 輸出只有檔案、行號與清單第幾項，不輸出命中的名稱、email 或該行內容（CI 紀錄會公開）。
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 本機的禁用名稱清單（不進版本控制，見 .gitignore）
export const LOCAL_NAMES_FILE = ".sensitive-names.local";
// CI 從這個環境變數讀取清單（repo secret）
export const NAMES_ENV = "SENSITIVE_NAMES";

// 放行的網域：RFC 2606／6761 保留的網域，比對本身與子網域
const RESERVED_DOMAINS = ["example.com", "example.org", "example.net"];
// 放行的頂級網域：RFC 2606／6761 保留
const RESERVED_TLDS = ["test", "example", "invalid", "localhost"];
// 資料集使用的虛構網域，比對本身與子網域；資料集加入虛構網域時一起修改（目前沒有）
export const FICTIONAL_DOMAINS = [];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

const underDomain = (domain, base) => domain === base || domain.endsWith(`.${base}`);

// 放行規則見 docs/testing.md「email」
export function isAllowedEmail(address) {
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at).toLowerCase();
  const domain = address.slice(at + 1).toLowerCase();
  if (local === "noreply") return true;
  if (underDomain(domain, "noreply.github.com")) return true;
  if ([...RESERVED_DOMAINS, ...FICTIONAL_DOMAINS].some((base) => underDomain(domain, base))) return true;
  return RESERVED_TLDS.includes(domain.slice(domain.lastIndexOf(".") + 1));
}

// 找出一行中的 email；頂級網域不是英文字母（例如套件版本 pkg@1.2.3）的不算
export function findEmails(line) {
  return [...line.matchAll(EMAIL)]
    .map((m) => m[0])
    .filter((address) => /^[A-Za-z]{2,}$/.test(address.slice(address.lastIndexOf(".") + 1)));
}

// 比對前的正規化：NFKC、轉小寫、去掉所有空白
export const normalize = (text) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");

// 清單一行一項，# 開頭的行是註解。回傳 [{ index: 清單第幾項（從 1 起算）, name: 正規化後的名稱 }]；
// 「第幾項」只算有效的項目，正規化後為空的行略過。
export function parseNames(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .map(normalize)
    .filter((name) => name !== "")
    .map((name, i) => ({ index: i + 1, name }));
}

// 取得禁用名稱清單。回傳 { names } 或 { names: null, warning } 或 { error }。
export function loadNames(root, env) {
  const fromEnv = env[NAMES_ENV];
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    const names = parseNames(fromEnv);
    return names.length > 0 ? { names } : { error: `repo secret ${NAMES_ENV} 沒有任何有效的項目` };
  }
  if (env.CI === "true") {
    return { error: `缺少 repo secret ${NAMES_ENV}：CI 中讀不到禁用名稱清單，不能略過名稱檢查（設定方式見 docs/testing.md）` };
  }
  let text;
  try {
    text = readFileSync(join(root, LOCAL_NAMES_FILE), "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return { names: null, warning: `找不到 ${LOCAL_NAMES_FILE}，略過禁用名稱檢查，只檢查 email（設定方式見 docs/testing.md）` };
  }
  return { names: parseNames(text) };
}

function trackedFiles(root) {
  return execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
}

function readText(path) {
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch (e) {
    // 已從工作目錄刪除但還在索引中的檔案、子模組等
    if (e.code === "ENOENT" || e.code === "EISDIR") return null;
    throw e;
  }
  return buffer.includes(0) ? null : buffer.toString("utf8");
}

// 掃描一份檔案的內容。names 為 null 時不檢查名稱。
// 回傳 [{ line: 行號（從 1 起算）, kind: "email" } | { line, kind: "name", index }]
export function scanText(text, names) {
  const findings = [];
  text.split(/\r?\n/).forEach((content, i) => {
    const line = i + 1;
    if (findEmails(content).some((address) => !isAllowedEmail(address))) findings.push({ line, kind: "email" });
    if (names) {
      const normalized = normalize(content);
      for (const { index, name } of names) {
        if (normalized.includes(name)) findings.push({ line, kind: "name", index });
      }
    }
  });
  return findings;
}

// 回傳 { errors: string[], warnings: string[], findings: string[] }；findings 只含檔案、行號與清單第幾項。
export function checkSensitive(root = process.cwd(), env = process.env) {
  const loaded = loadNames(root, env);
  const errors = loaded.error ? [loaded.error] : [];
  const warnings = loaded.warning ? [loaded.warning] : [];
  const names = loaded.names ?? null;
  const findings = [];
  for (const file of trackedFiles(root)) {
    const text = readText(join(root, file));
    if (text === null) continue;
    for (const f of scanText(text, names)) {
      findings.push(
        f.kind === "email"
          ? `${file}:${f.line} 有不在放行清單內的 email`
          : `${file}:${f.line} 命中禁用名稱清單第 ${f.index} 項`,
      );
    }
  }
  return { errors, warnings, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, warnings, findings } = checkSensitive(resolve(process.argv[2] ?? "."));
  for (const w of warnings) console.warn(`警告：${w}`);
  for (const e of errors) console.error(`錯誤：${e}`);
  for (const f of findings) console.error(f);
  if (errors.length > 0 || findings.length > 0) {
    console.error(`敏感資料檢查失敗：${findings.length} 處命中${errors.length > 0 ? `，${errors.length} 個錯誤` : ""}`);
    process.exit(1);
  }
  console.log("敏感資料檢查通過");
}
