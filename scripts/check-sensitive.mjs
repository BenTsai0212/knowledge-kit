// 敏感資料檢查：掃描 git ls-files 列出的檔案，找出個人 email 與禁用名稱（#66，見 docs/testing.md）。
// 用法：node scripts/check-sensitive.mjs [--history | --github | --file <路徑>] [repo 根目錄，預設目前目錄]
// --history 改為掃描所有 ref 的每個 commit：新增的行、commit 訊息與作者名稱（#99）。
// --github 改為以 gh api graphql 掃描本 repo 所有 Issue 與 PR 的文字與編輯紀錄（#111）。
// --file <路徑> 改為只檢查一個檔案（不必在 git 中），另外檢查個人路徑：送出 Issue 或留言前的自我檢查（#136）。
// 輸出只有檔案、行號（或 commit 短 SHA、Issue／PR 的位置）與清單第幾項，不輸出命中的名稱、email 或該行內容（CI 紀錄會公開）。
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 本機的禁用名稱清單（不進版本控制，見 .gitignore）
export const LOCAL_NAMES_FILE = ".sensitive-names.local";
// CI 從這個環境變數讀取清單（repo secret）
export const NAMES_ENV = "SENSITIVE_NAMES";

// 放行的網域：RFC 2606／6761 保留的網域，比對本身與子網域
const RESERVED_DOMAINS = ["example.com", "example.org", "example.net"];
// 放行的頂級網域：RFC 2606／6761 保留，加上文件說明格式時常用的 .tld（不是實際存在的頂級網域，#113）
const RESERVED_TLDS = ["test", "example", "invalid", "localhost", "tld"];
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

const describe = (where, f) =>
  f.kind === "email" ? `${where} 有不在放行清單內的 email` : `${where} 命中禁用名稱清單第 ${f.index} 項`;

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
    for (const f of scanText(text, names)) findings.push(describe(`${file}:${f.line}`, f));
  }
  return { errors, warnings, findings };
}

// ---- 整段歷史模式（#99） ----

// git log 輸出的分隔字元：commit 開頭、欄位之間、commit 訊息結尾
const COMMIT = "\x01";
const FIELD = "\x02";
const HEADER_END = "\x03";

// 所有 ref 的每個 commit 與它新增的內容（第一個 commit 與空白比較）。合併 commit 與第一個 parent 比較，合併時才加入的內容也會掃到；
// 固定路徑前綴、不轉換內容、不加顏色，不受使用者的 git 設定影響。二進位檔只有一行說明，沒有內容。
function gitLogAll(root) {
  const format = [`${COMMIT}%H`, "%h", "%an", "%ae", "%cn", "%ce", `%B${HEADER_END}`].join(FIELD);
  const args = ["-C", root, "-c", "core.quotePath=false", "log", "--all", "--root", "-p", "--diff-merges=first-parent"];
  args.push("--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", `--format=${format}`);
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30 });
}

// 解析一個 commit 的 diff，回傳 [{ path, text }]：每個檔案新增的行（以換行連接）。
// 依 hunk 標頭的行數判斷哪些行屬於 hunk，內容以 "++" 開頭的新增行才不會被當成檔名。
export function addedLines(diff) {
  const files = new Map();
  let path = null;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith("+")) {
        newLeft -= 1;
        if (path !== null) files.set(path, [...(files.get(path) ?? []), line.slice(1)]);
      } else if (line.startsWith("-")) {
        oldLeft -= 1;
      } else if (line.startsWith(" ") || line === "") {
        oldLeft -= 1;
        newLeft -= 1;
      }
      // 「\ No newline at end of file」不計入行數
      continue;
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).replace(/\t$/, "");
      path = target.startsWith("b/") ? target.slice(2) : null; // /dev/null：刪除的檔案
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
    }
  }
  return [...files].map(([file, lines]) => ({ path: file, text: lines.join("\n") }));
}

// 同一個 commit 的同一處只回報一次：email 一筆、清單每一項各一筆，依清單順序
function distinct(findings) {
  const seen = new Map();
  for (const f of findings) seen.set(f.kind === "email" ? 0 : f.index, f);
  return [...seen].sort(([a], [b]) => a - b).map(([, f]) => f);
}

// 已知保留 email 的分界：PR #94 的合併 commit。依 RFC 0002 待決問題 1 的決定（A1，Epic #93 的 `## 決定`）不改寫歷史，
// 這個 commit 之前（它的祖先，不含它本身）的作者與提交者 email 只列出數量、不算失敗；之後的照常算失敗（#113）。
export const KNOWN_EMAIL_BOUNDARY = "19a2cbc962a999438fe4359a72d4d018d53d79c9";

// 分界之前的 commit（完整 SHA）；repo 中沒有分界 commit 時（例如 fork 後的新歷史）是空的
function commitsBefore(root, boundary) {
  const found = spawnSync("git", ["-C", root, "rev-parse", "--verify", "--quiet", `${boundary}^{commit}`], { encoding: "utf8" });
  if (found.status !== 0) return new Set();
  const shas = execFileSync("git", ["-C", root, "rev-list", found.stdout.trim()], { encoding: "utf8", maxBuffer: 1 << 30 });
  const before = new Set(shas.split("\n").filter(Boolean));
  before.delete(found.stdout.trim());
  return before;
}

// 每個地址各有幾個 commit，不含地址本身
const commitCounts = (byAddress) => [...byAddress.values()].map((shas) => shas.size);

// 回傳 { errors, warnings, findings, commits, authorEmails, knownEmails }。
// findings 只含 commit 短 SHA、檔案路徑（或「commit 訊息」、「作者名稱」）與清單第幾項；
// commit 作者與提交者的 email 不逐筆列出：authorEmails 是分界之後每個不在放行清單內的地址各有幾個 commit，
// knownEmails 是分界之前（已知保留）的，都不含地址本身。
export function checkHistory(root = process.cwd(), env = process.env, { boundary = KNOWN_EMAIL_BOUNDARY } = {}) {
  const loaded = loadNames(root, env);
  const errors = loaded.error ? [loaded.error] : [];
  const warnings = loaded.warning ? [loaded.warning] : [];
  const names = loaded.names ?? null;
  const findings = [];
  const before = commitsBefore(root, boundary);
  const emailCommits = new Map();
  const knownCommits = new Map();
  let commits = 0;
  for (const chunk of gitLogAll(root).split(COMMIT).slice(1)) {
    commits += 1;
    const end = chunk.indexOf(HEADER_END);
    const [sha, short, authorName, authorEmail, committerName, committerEmail, message] = chunk.slice(0, end).split(FIELD);
    for (const f of distinct(scanText(message, names))) findings.push(describe(`${short} commit 訊息`, f));
    for (const f of distinct(scanText(`${authorName}\n${committerName}`, names))) findings.push(describe(`${short} 作者名稱`, f));
    for (const address of new Set([authorEmail, committerEmail])) {
      if (!address.includes("@") || isAllowedEmail(address)) continue;
      const counts = before.has(sha) ? knownCommits : emailCommits;
      counts.set(address, (counts.get(address) ?? new Set()).add(sha));
    }
    for (const { path, text } of addedLines(chunk.slice(end + 1))) {
      for (const f of distinct(scanText(text, names))) findings.push(describe(`${short} ${path}`, f));
    }
  }
  return { errors, warnings, findings, commits, authorEmails: commitCounts(emailCommits), knownEmails: commitCounts(knownCommits) };
}

// ---- GitHub 模式（#111） ----

// 個人路徑：/Users/<名稱>、/home/<名稱>；GitHub Actions 的執行環境 /home/runner 不算（#113）。
// tools/workflow/personal-paths.test.mjs 與 check-post-body.mjs（#124）匯入同一條規則
export const PERSONAL_PATH = /\/(?:Users\/|home\/(?!runner(?![\w.-])))[\w.-]+/;

// 讀取的連線：別名 → GraphQL 欄位、每頁幾筆、節點的欄位與底下的連線。
// 有下層連線的節點都帶 id 與 __typename，下一頁以 node(id) 讀取。
// 每頁筆數兼顧 GraphQL 的節點上限（50 萬）與速率限制的點數。
const CONNECTIONS = {
  issues: { field: "issues", first: 20, nodes: "number title body", children: ["edits", "renames", "comments"] },
  pullRequests: { field: "pullRequests", first: 20, nodes: "number title body", children: ["edits", "renames", "comments", "reviews"] },
  edits: { field: "userContentEdits", first: 10, nodes: "editedAt diff" },
  renames: { field: "timelineItems", args: "itemTypes: [RENAMED_TITLE_EVENT]", first: 10, nodes: "... on RenamedTitleEvent { createdAt previousTitle }" },
  comments: { field: "comments", first: 50, nodes: "url body", children: ["edits"] },
  reviews: { field: "reviews", first: 10, nodes: "url body", children: ["edits", "reviewComments"] },
  reviewComments: { field: "comments", first: 20, nodes: "url body", children: ["edits"] },
};
const ORDER = "orderBy: { field: CREATED_AT, direction: ASC }";

function connectionField(key, { after = false } = {}) {
  const c = CONNECTIONS[key];
  const top = key === "issues" || key === "pullRequests";
  const args = [`first: ${c.first}`, c.args, top && ORDER, after && "after: $cursor"].filter(Boolean).join(", ");
  const children = c.children ? `id __typename ${c.children.map((k) => connectionField(k)).join(" ")}` : "";
  return `${key}: ${c.field}(${args}) { pageInfo { hasNextPage endCursor } nodes { ${c.nodes} ${children} } }`;
}

export const topQuery = (key) =>
  `query($owner: String!, $name: String!, $cursor: String) { repository(owner: $owner, name: $name) { ${connectionField(key, { after: true })} } }`;
export const moreQuery = (typename, key) =>
  `query($id: ID!, $cursor: String) { node(id: $id) { ... on ${typename} { ${connectionField(key, { after: true })} } } }`;

// 讀完 node（屬於連線 parentKey）底下每個連線的其餘分頁（就地補進 nodes），再往下層補
function complete(graphql, node, parentKey) {
  for (const key of CONNECTIONS[parentKey].children ?? []) {
    const conn = node[key];
    while (conn.pageInfo.hasNextPage) {
      const next = graphql(moreQuery(node.__typename, key), { id: node.id, cursor: conn.pageInfo.endCursor }).node[key];
      conn.nodes.push(...next.nodes);
      conn.pageInfo = next.pageInfo;
    }
    for (const child of conn.nodes) complete(graphql, child, key);
  }
}

// 讀取本 repo 所有 Issue 或 PR（含已關閉），每一層都讀完全部分頁
function fetchAll(graphql, repo, key) {
  const [owner, name] = repo.split("/");
  const items = [];
  let cursor = null;
  do {
    const conn = graphql(topQuery(key), { owner, name, cursor }).repository[key];
    items.push(...conn.nodes);
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor !== null);
  for (const item of items) complete(graphql, item, key);
  return items;
}

// 一段文字與它的編輯紀錄：編輯紀錄依時間由舊到新編號（第 1 版最舊）；已刪除的版本沒有 diff，只佔編號
function* withEdits(where, body, edits) {
  yield [where, body];
  const versions = [...edits.nodes].sort((a, b) => a.editedAt.localeCompare(b.editedAt));
  for (const [i, edit] of versions.entries()) {
    if (edit.diff) yield [`${where}，編輯紀錄第 ${i + 1} 版（${edit.editedAt}）`, edit.diff];
  }
}

// 一個 Issue 或 PR 的每一段文字：[位置, 文字]
export function* postTexts(label, item) {
  const where = `${label} #${item.number}`;
  yield [`${where} 標題`, item.title];
  for (const r of item.renames.nodes) {
    if (r.previousTitle) yield [`${where} 標題，改名前的標題（${r.createdAt}）`, r.previousTitle];
  }
  yield* withEdits(`${where} 描述`, item.body, item.edits);
  for (const c of item.comments.nodes) yield* withEdits(`${where} 留言 ${c.url}`, c.body, c.edits);
  for (const r of item.reviews?.nodes ?? []) {
    yield* withEdits(`${where} review ${r.url}`, r.body, r.edits);
    for (const c of r.reviewComments.nodes) yield* withEdits(`${where} review comment ${c.url}`, c.body, c.edits);
  }
}

// 一段文字的命中：個人路徑一筆、email 一筆、清單每一項各一筆
export function scanPost(text, names) {
  const findings = distinct(scanText(text ?? "", names));
  return PERSONAL_PATH.test(text ?? "") ? [{ kind: "path" }, ...findings] : findings;
}

const describePost = (where, f) => (f.kind === "path" ? `${where} 有個人路徑（/Users/<名稱> 或 /home/<名稱>）` : describe(where, f));

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function runGh(args, cwd) {
  const result = spawnSync("gh", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// 以 gh api graphql 執行一個查詢。遇到速率限制時等待後重試，超過次數時以說明停止。
export function ghGraphql(query, variables, { run = runGh, sleep = sleepSync, attempts = 3, waitMs = 60_000 } = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(variables)) if (v !== null && v !== undefined) args.push("-f", `${k}=${v}`);
  for (let attempt = 1; ; attempt += 1) {
    const { status, stdout, stderr } = run(args);
    if (status === 0) return JSON.parse(stdout).data;
    if (!/rate limit/i.test(`${stdout}${stderr}`)) {
      throw new Error(`gh api graphql 失敗：${stderr.trim() || `結束碼 ${status}`}`);
    }
    if (attempt >= attempts) {
      throw new Error(`GitHub API 速率限制：重試 ${attempts} 次仍未解除，停止。以 gh api rate_limit 查看重置時間後重新執行`);
    }
    console.warn(`警告：GitHub API 速率限制，${waitMs / 1000} 秒後重試（第 ${attempt} 次）`);
    sleep(waitMs);
  }
}

// 確認 gh 已登入，取得目前的 repo（owner/name）。回傳 { repo } 或 { error }。
export function githubRepo(root, run = runGh) {
  if (run(["auth", "status"], root).status !== 0) {
    return { error: "gh 沒有登入：先由人在本機執行 gh auth login，再重新執行" };
  }
  const { status, stdout, stderr } = run(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], root);
  if (status !== 0) return { error: `找不到 GitHub repo：${stderr.trim()}` };
  return { repo: stdout.trim() };
}

// 回傳 { errors, warnings, findings, issues, pullRequests, texts }；findings 只含位置與清單第幾項。
export function checkGitHub(root = process.cwd(), env = process.env, { graphql = ghGraphql, repo } = {}) {
  const loaded = loadNames(root, env);
  const errors = loaded.error ? [loaded.error] : [];
  const warnings = loaded.warning ? [loaded.warning] : [];
  const names = loaded.names ?? null;
  const findings = [];
  const counts = { issues: 0, pullRequests: 0, texts: 0 };
  const target = repo ? { repo } : githubRepo(root);
  if (target.error) return { errors: [...errors, target.error], warnings, findings, ...counts };
  try {
    for (const [key, label] of [["issues", "Issue"], ["pullRequests", "PR"]]) {
      const items = fetchAll(graphql, target.repo, key);
      counts[key] = items.length;
      for (const item of items) {
        for (const [where, text] of postTexts(label, item)) {
          counts.texts += 1;
          for (const f of scanPost(text, names)) findings.push(describePost(where, f));
        }
      }
    }
  } catch (e) {
    errors.push(e.message);
  }
  return { errors, warnings, findings, ...counts };
}

// ---- 單一檔案模式 ----

// 送出 Issue、留言之前的自我檢查（例如決策中心；dev-workflow-template#49）：檔案不必在 git 中。
// file 以目前目錄為準，root 只用來讀取禁用名稱清單。比對禁用名稱、email 與個人路徑，依行號排列。回傳 { errors, warnings, findings }；findings 只含檔案、行號與清單第幾項。
export function checkFile(file, root = process.cwd(), env = process.env) {
  const loaded = loadNames(root, env);
  const errors = loaded.error ? [loaded.error] : [];
  const warnings = loaded.warning ? [loaded.warning] : [];
  const text = readText(resolve(file));
  if (text === null) return { errors: [...errors, `無法讀取文字檔：${file}`], warnings, findings: [] };
  const hits = scanText(text, loaded.names ?? null).map((f) => ({ line: f.line, message: describe(`${file}:${f.line}`, f) }));
  text.split(/\r?\n/).forEach((content, i) => {
    if (PERSONAL_PATH.test(content)) hits.push({ line: i + 1, message: describePost(`${file}:${i + 1}`, { kind: "path" }) });
  });
  hits.sort((a, b) => a.line - b.line);
  return { errors, warnings, findings: hits.map((h) => h.message) };
}

// 檢查結果的輸出與結束碼。mode 是 "files"、"file"、"history" 或 "github"；回傳 { out, warn, err, status }（每一行一個字串）
export function report(mode, result) {
  const { errors, warnings, findings } = result;
  const authorEmails = result.authorEmails ?? [];
  const knownEmails = result.knownEmails ?? [];
  const out = [];
  const warn = warnings.map((w) => `警告：${w}`);
  const err = [...errors.map((e) => `錯誤：${e}`), ...findings];
  authorEmails.forEach((count, i) => {
    err.push(`commit 作者或提交者的 email 不在放行清單內：第 ${i + 1} 個地址，${count} 個 commit`);
  });
  if (knownEmails.length > 0) {
    const commits = knownEmails.reduce((sum, count) => sum + count, 0);
    out.push(`已知保留的作者或提交者 email（PR #94 之前的 commit，RFC 0002 待決問題 1 的決定 A1）：${knownEmails.length} 個地址，${commits} 個 commit`);
  }
  const scope = {
    github: `（GitHub，${result.issues} 個 Issue、${result.pullRequests} 個 PR、${result.texts} 段文字）`,
    history: `（整段歷史，${result.commits} 個 commit）`,
    file: "（單一檔案）",
  }[mode] ?? "";
  if (errors.length > 0 || findings.length > 0 || authorEmails.length > 0) {
    const parts = [`${findings.length} 處命中`];
    if (authorEmails.length > 0) parts.push(`${authorEmails.length} 個作者 email 地址`);
    if (errors.length > 0) parts.push(`${errors.length} 個錯誤`);
    err.push(`敏感資料檢查${scope}失敗：${parts.join("，")}`);
    return { out, warn, err, status: 1 };
  }
  out.push(`敏感資料檢查${scope}通過`);
  return { out, warn, err, status: 0 };
}

function main(args) {
  const fileAt = args.indexOf("--file");
  const file = fileAt >= 0 ? args[fileAt + 1] : undefined;
  if (fileAt >= 0 && (!file || file.startsWith("--"))) {
    console.error("用法：node scripts/check-sensitive.mjs --file <路徑>");
    process.exitCode = 2;
    return;
  }
  const mode = file ? "file" : args.includes("--github") ? "github" : args.includes("--history") ? "history" : "files";
  const rest = args.filter((arg, i) => !arg.startsWith("--") && !(file && i === fileAt + 1));
  const root = resolve(rest[0] ?? ".");
  const check = { github: checkGitHub, history: checkHistory, files: checkSensitive, file: (r) => checkFile(file, r) }[mode];
  const { out, warn, err, status } = report(mode, check(root));
  for (const line of warn) console.warn(line);
  for (const line of err) console.error(line);
  for (const line of out) console.log(line);
  process.exitCode = status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
