import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_NAMES_FILE,
  KNOWN_EMAIL_BOUNDARY,
  NAMES_ENV,
  addedLines,
  checkGitHub,
  checkHistory,
  findEmails,
  ghGraphql,
  githubRepo,
  isAllowedEmail,
  normalize,
  parseNames,
  report,
  scanPost,
} from "./check-sensitive.mjs";

const SCRIPT = fileURLToPath(new URL("./check-sensitive.mjs", import.meta.url));
// email 與名稱以字串組合產生，這份測試檔本身才不會被檢查擋下
const at = (local, domain) => `${local}${"@"}${domain}`;
const PERSONAL = at("mei.lin", "corp-mail.com");
// 虛構的禁用名稱
const NAME_A = ["Zephyr", "anth", "Corp"].join("");
const NAME_B = ["青嵐", "綠能"].join("");

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// 在暫存目錄建立 git repo，files 為 { 路徑: 內容 }，全部 git add（不 commit）
function repo(files, { untracked = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-sensitive-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root]);
  for (const [path, content] of Object.entries({ ...files, ...untracked })) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if (Object.keys(files).length > 0) execFileSync("git", ["-C", root, "add", "--", ...Object.keys(files)]);
  return root;
}

// 執行腳本；env 只帶 PATH 與指定的變數，不受 CI 本身的環境影響
function run(root, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, root], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("check-sensitive", () => {
  it("正規化：NFKC、轉小寫、去掉空白", () => {
    expect(normalize("Ｚｅｐｈｙｒ ａｎｔｈ　Corp")).toBe(normalize(NAME_A));
    expect(parseNames(`# 註解\n${NAME_A}\n\n  \n${NAME_B}\r\n`)).toEqual([
      { index: 1, name: normalize(NAME_A) },
      { index: 2, name: normalize(NAME_B) },
    ]);
  });

  it("email 的放行清單", () => {
    for (const address of [
      at("noreply", "anthropic.com"),
      at("12345+someone", "users.noreply.github.com"),
      at("ops", "example.com"),
      at("ops", "mail.example.org"),
      at("ops", "example.net"),
      at("ops", "site.test"),
      at("ops", "demo.example"),
      at("ops", "x.invalid"),
      at("ops", "dev.localhost"),
      at("local", "domain.tld"),
      at("me", "MAIL.TLD"),
      at("git", "github.com"),
      at("GIT", "gitlab.com"),
    ]) {
      expect(isAllowedEmail(address), address).toBe(true);
    }
    for (const address of [
      PERSONAL,
      at("ops", "notexample.com"),
      at("ops", "example.com.tw"),
      at("no-reply", "corp-mail.com"),
      at("ops", "tld.com"),
      at("ops", "mail.tlds"),
      at("gitbot", "corp-mail.com"),
      at("my.git", "corp-mail.com"),
    ]) {
      expect(isAllowedEmail(address), address).toBe(false);
    }
    expect(findEmails(`"vite": "${at("npm:vite", "8.3.5")}"`)).toEqual([]);
    // SSH 的 clone 網址整行也放行（git@<主機>:<owner>/<name>.git）
    expect(findEmails("git@github.com:owner/name.git").every(isAllowedEmail)).toBe(true);
  });

  it("個人 email 與清單中的名稱都會被擋，輸出只有檔案、行號與清單第幾項", () => {
    const root = repo({
      "docs/a.md": `第一行\n聯絡 ${PERSONAL}\n允許 ${at("ops", "example.com")}\n`,
      "client/b.json": `{\n  "name": "${NAME_A.toUpperCase()}"\n}\n`,
      "client/c.md": `全形與空白：${"Ｚｅｐｈｙｒ ａｎｔｈ ｃｏｒｐ"}\n${NAME_B.split("").join(" ")}\n`,
    });
    const { status, output } = run(root, { CI: "true", [NAMES_ENV]: `# 測試清單\n${NAME_A}\n${NAME_B}\n` });

    expect(status).toBe(1);
    expect(output).toContain("docs/a.md:2 有不在放行清單內的 email");
    expect(output).not.toContain("docs/a.md:3");
    expect(output).toContain("client/b.json:2 命中禁用名稱清單第 1 項");
    expect(output).toContain("client/c.md:1 命中禁用名稱清單第 1 項");
    expect(output).toContain("client/c.md:2 命中禁用名稱清單第 2 項");
    // 紀錄中不出現名稱與 email 本身
    for (const secret of [NAME_A, NAME_B, "Zephyr", "corp-mail", PERSONAL]) {
      expect(output.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("只掃 git ls-files 列出的檔案，略過二進位檔", () => {
    const root = repo(
      { "ok.md": "沒有問題\n", "bin.dat": Buffer.from([0, ...Buffer.from(PERSONAL)]) },
      { untracked: { "untracked.md": `${PERSONAL}\n${NAME_A}\n` } },
    );
    const { status, output } = run(root, { CI: "true", [NAMES_ENV]: NAME_A });
    expect(output).toContain("敏感資料檢查通過");
    expect(status).toBe(0);
  });

  it("CI 缺少 secret 時失敗並說明原因；email 照常檢查", () => {
    const root = repo({ "a.md": `${PERSONAL}\n` });
    for (const env of [{ CI: "true" }, { CI: "true", [NAMES_ENV]: "" }, { CI: "true", [NAMES_ENV]: " \n" }]) {
      const { status, output } = run(root, env);
      expect(status).toBe(1);
      expect(output).toContain(`缺少 repo secret ${NAMES_ENV}`);
      expect(output).toContain("a.md:1 有不在放行清單內的 email");
    }
    const commentsOnly = run(root, { CI: "true", [NAMES_ENV]: "# 只有註解" });
    expect(commentsOnly.status).toBe(1);
    expect(commentsOnly.output).toContain(`repo secret ${NAMES_ENV} 沒有任何有效的項目`);
  });

  it("本機讀取不進版本控制的清單檔；沒有清單檔時只顯示警告", () => {
    const clean = repo({ "a.md": `${NAME_B}\n` });
    const skipped = run(clean);
    expect(skipped.status).toBe(0);
    expect(skipped.output).toContain(`警告：找不到 ${LOCAL_NAMES_FILE}，略過禁用名稱檢查`);

    const withList = repo({ "a.md": `${NAME_B}\n` }, { untracked: { [LOCAL_NAMES_FILE]: `${NAME_A}\n${NAME_B}\n` } });
    const blocked = run(withList);
    expect(blocked.status).toBe(1);
    expect(blocked.output).toContain("a.md:1 命中禁用名稱清單第 2 項");
    expect(blocked.output).not.toContain(NAME_B);
  });
});

describe("check-sensitive --file", () => {
  const USER_PATH = ["", "Users", "someone", "kit"].join("/");
  const runFile = (args, env = {}) => {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };

  it("檢查不在 git 中的檔案：email、個人路徑與禁用名稱依行號列出，不輸出命中的文字", () => {
    const root = repo({}, { untracked: { "post.md": `## 決定\n${NAME_A}\n路徑 ${USER_PATH}/x，寄給 ${PERSONAL}\n` } });
    const file = join(root, "post.md");
    const { status, output } = runFile(["--file", file, root], { CI: "true", [NAMES_ENV]: NAME_A });
    expect(status).toBe(1);
    const lines = output.split("\n").filter((l) => l.startsWith(file));
    expect(lines).toEqual([
      `${file}:2 命中禁用名稱清單第 1 項`,
      `${file}:3 有不在放行清單內的 email`,
      `${file}:3 有個人路徑（/Users/<名稱> 或 /home/<名稱>）`,
    ]);
    expect(output).toContain("敏感資料檢查（單一檔案）失敗：3 處命中");
    for (const secret of [NAME_A, "someone", PERSONAL]) expect(output).not.toContain(secret);
  });

  it("沒有命中時通過；/home/runner 與佔位寫法不算；缺少路徑或讀不到時失敗", () => {
    const root = repo({}, { untracked: { "ok.md": `${["", "home", "runner", "work"].join("/")}\n/Users/<名稱>/…\n${at("user", "example.com")}\n` } });
    const passed = runFile(["--file", join(root, "ok.md"), root]);
    expect(passed.output).toContain("敏感資料檢查（單一檔案）通過");
    expect(passed.status).toBe(0);
    expect(runFile(["--file"]).status).toBe(2);
    const missing = runFile(["--file", join(root, "missing.md"), root]);
    expect(missing.status).toBe(1);
    expect(missing.output).toContain("無法讀取文字檔");
  });
});

describe("check-sensitive --history", () => {
  const ALLOWED = at("dev", "example.com");
  const LIST = { CI: "true", [NAMES_ENV]: `${NAME_A}\n${NAME_B}\n` };

  // 在 root 中寫入 files（內容為 null 時刪除）並 commit；回傳短 SHA
  function commit(root, files, { message = "update", author = "Dev", email = ALLOWED } = {}) {
    for (const [path, content] of Object.entries(files)) {
      if (content === null) {
        execFileSync("git", ["-C", root, "rm", "-q", "--", path]);
        continue;
      }
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), content);
      execFileSync("git", ["-C", root, "add", "--", path]);
    }
    const identity = { GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: email };
    execFileSync("git", ["-C", root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", message], {
      env: { ...process.env, ...identity },
    });
    return execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  }

  function runHistory(root, env = {}) {
    const result = spawnSync(process.execPath, [SCRIPT, "--history", root], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, ...env },
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it("抓得到歷史中已刪除的名稱與 email，目前模式抓不到；輸出不含命中的文字", () => {
    const root = repo({});
    const added = commit(root, { "docs/old.md": `第一行\n${NAME_A.toLowerCase()} 的合約\n聯絡 ${PERSONAL}\n`, "ok.md": "沒有問題\n" });
    commit(root, { "docs/old.md": null });

    const current = run(root, LIST);
    expect(current.output).toContain("敏感資料檢查通過");
    expect(current.status).toBe(0);

    const { status, output } = runHistory(root, LIST);
    expect(status).toBe(1);
    expect(output).toContain(`${added} docs/old.md 有不在放行清單內的 email`);
    expect(output).toContain(`${added} docs/old.md 命中禁用名稱清單第 1 項`);
    expect(output).not.toContain("ok.md");
    expect(output).toContain("敏感資料檢查（整段歷史，2 個 commit）失敗：2 處命中");
    for (const secret of [NAME_A, NAME_B, "Zephyr", "corp-mail", PERSONAL, "合約"]) {
      expect(output.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("掃描 commit 訊息、作者名稱與其他分支；作者 email 只統計數量", () => {
    const root = repo({});
    const first = commit(root, { "a.md": "a\n" }, { message: `修正 ${NAME_B} 的資料\n\n聯絡 ${PERSONAL}` });
    const second = commit(root, { "a.md": "b\n" }, { author: `${NAME_A} Bot`, email: PERSONAL });
    commit(root, { "a.md": "c\n" }, { email: PERSONAL });
    execFileSync("git", ["-C", root, "switch", "-q", "-c", "side", first]);
    const side = commit(root, { "side.md": `${NAME_B}\n` });
    execFileSync("git", ["-C", root, "switch", "-q", "-"]);

    const { status, output } = runHistory(root, LIST);
    expect(status).toBe(1);
    expect(output).toContain(`${first} commit 訊息 有不在放行清單內的 email`);
    expect(output).toContain(`${first} commit 訊息 命中禁用名稱清單第 2 項`);
    expect(output).toContain(`${second} 作者名稱 命中禁用名稱清單第 1 項`);
    expect(output).toContain(`${side} side.md 命中禁用名稱清單第 2 項`);
    expect(output).toContain("commit 作者或提交者的 email 不在放行清單內：第 1 個地址，2 個 commit");
    expect(output).toContain("敏感資料檢查（整段歷史，4 個 commit）失敗：4 處命中，1 個作者 email 地址");
    for (const secret of [NAME_A, NAME_B, "Zephyr", "corp-mail", PERSONAL]) {
      expect(output.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("範例格式的 .tld email 在檔案、commit 訊息與作者 email 都不算命中", () => {
    const sample = at("local", "domain.tld");
    const root = repo({});
    commit(root, { "a.md": `格式：${sample}\n` }, { message: `說明 ${sample}`, email: sample });
    expect(run(root, LIST).status).toBe(0);
    const { status, output } = runHistory(root, LIST);
    expect(output).toContain("敏感資料檢查（整段歷史，1 個 commit）通過");
    expect(status).toBe(0);
  });

  it("分界之前的作者與提交者 email 只列為已知保留，之後的照常失敗", () => {
    const root = repo({});
    commit(root, { "a.md": "a\n" }, { email: PERSONAL });
    commit(root, { "a.md": "b\n" }, { email: PERSONAL });
    commit(root, { "a.md": "c\n" });
    const boundary = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    const known = checkHistory(root, LIST, { boundary });
    expect(known).toMatchObject({ findings: [], authorEmails: [], knownEmails: [2], commits: 3 });
    const passed = report("history", known);
    expect(passed.status).toBe(0);
    expect(passed.out).toEqual([
      "已知保留的作者或提交者 email（PR #94 之前的 commit，RFC 0002 待決問題 1 的決定 A1）：1 個地址，2 個 commit",
      "敏感資料檢查（整段歷史，3 個 commit）通過",
    ]);

    // 分界 commit 本身與之後的 commit 照常算失敗
    commit(root, { "a.md": "d\n" }, { email: PERSONAL });
    const after = checkHistory(root, LIST, { boundary });
    expect(after).toMatchObject({ authorEmails: [1], knownEmails: [2] });
    const failed = report("history", after);
    expect(failed.status).toBe(1);
    expect(failed.err).toContain("commit 作者或提交者的 email 不在放行清單內：第 1 個地址，1 個 commit");
    expect(failed.err.at(-1)).toBe("敏感資料檢查（整段歷史，4 個 commit）失敗：0 處命中，1 個作者 email 地址");
    const onBoundary = checkHistory(root, LIST, { boundary: execFileSync("git", ["-C", root, "rev-parse", "HEAD~2"], { encoding: "utf8" }).trim() });
    expect(onBoundary).toMatchObject({ authorEmails: [2], knownEmails: [1] });

    // 分界 commit 不在 repo 中時沒有已知保留；預設的分界是 PR #94 的合併 commit
    expect(checkHistory(root, LIST)).toMatchObject({ authorEmails: [3], knownEmails: [] });
    expect(KNOWN_EMAIL_BOUNDARY).toMatch(/^19a2cbc[0-9a-f]{33}$/);
    for (const line of [...passed.out, ...failed.err]) expect(line.toLowerCase()).not.toContain("corp-mail");
  });

  it("沒有命中時通過；沒有清單檔時只檢查 email", () => {
    const root = repo({});
    commit(root, { "a.md": `${NAME_A}\n` });
    const skipped = runHistory(root);
    expect(skipped.status).toBe(0);
    expect(skipped.output).toContain(`警告：找不到 ${LOCAL_NAMES_FILE}`);
    expect(skipped.output).toContain("敏感資料檢查（整段歷史，1 個 commit）通過");
    expect(runHistory(root, { CI: "true", [NAMES_ENV]: NAME_B }).status).toBe(0);
  });

  it("diff 解析：依 hunk 的行數判斷新增的行，內容以 ++ 開頭也不會被當成檔名", () => {
    const diff = [
      "diff --git a/x.md b/x.md",
      "--- a/x.md",
      "+++ b/x.md",
      "@@ -1,2 +1,2 @@",
      "--- 舊的一行",
      "+++ 新的一行",
      " 不變",
      "\\ No newline at end of file",
      "diff --git a/gone.md b/gone.md",
      "deleted file mode 100644",
      "--- a/gone.md",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-刪掉",
      "diff --git a/new file.md b/new file.md",
      "--- /dev/null",
      "+++ b/new file.md\t",
      "@@ -0,0 +1 @@",
      "+新檔",
      "",
    ].join("\n");
    expect(addedLines(diff)).toEqual([
      { path: "x.md", text: "++ 新的一行" },
      { path: "new file.md", text: "新檔" },
    ]);
  });
});

describe("check-sensitive --github", () => {
  const LIST = { CI: "true", [NAMES_ENV]: `${NAME_A}\n${NAME_B}\n` };
  // 以 join 組出個人路徑，避免本檔被 personal-paths 的檢查抓到
  const HOME_PATH = ["", "Users", "someone", "Projects"].join("/");
  const PAGE = 2;
  const TYPES = {
    issues: "Issue",
    pullRequests: "PullRequest",
    comments: "IssueComment",
    reviews: "PullRequestReview",
    reviewComments: "PullRequestReviewComment",
  };

  // 假的 GitHub GraphQL：tree 中的陣列是連線，每頁固定 PAGE 筆（不看 first），下一頁以 node(id) 讀取
  function fakeGitHub(tree) {
    const byId = new Map();
    const register = (node, typename) => {
      for (const [key, value] of Object.entries(node)) {
        if (Array.isArray(value) && TYPES[key]) value.forEach((child) => register(child, TYPES[key]));
      }
      Object.assign(node, { id: `node-${byId.size + 1}`, __typename: typename });
      byId.set(node.id, node);
    };
    register(tree, "Repository");
    const serve = (node, key, cursor) => {
      const start = cursor === null ? 0 : Number(cursor);
      const end = start + PAGE;
      const hasNextPage = end < node[key].length;
      return {
        pageInfo: { hasNextPage, endCursor: hasNextPage ? String(end) : null },
        nodes: node[key].slice(start, end).map(shape),
      };
    };
    const shape = (node) =>
      Object.fromEntries(Object.entries(node).map(([k, v]) => [k, Array.isArray(v) ? serve(node, k, null) : v]));
    const calls = [];
    const graphql = (query, variables) => {
      calls.push(query);
      const cursor = variables.cursor ?? null;
      if (variables.owner) {
        const key = query.includes("pullRequests(") ? "pullRequests" : "issues";
        return { repository: { [key]: serve(tree, key, cursor) } };
      }
      const key = /\.\.\. on \w+ \{ (\w+):/.exec(query)[1];
      return { node: { [key]: serve(byId.get(variables.id), key, cursor) } };
    };
    return { graphql, calls };
  }

  const post = (number, fields = {}) => ({ number, title: `標題 ${number}`, body: "內容", edits: [], renames: [], comments: [], ...fields });
  const comment = (url, body, edits = []) => ({ url, body, edits });
  const edit = (editedAt, diff) => ({ editedAt, diff });

  function check(tree, env = LIST) {
    const { graphql, calls } = fakeGitHub(tree);
    return { ...checkGitHub(process.cwd(), env, { graphql, repo: "owner/repo" }), calls };
  }

  it("現在的內容沒有、只在編輯紀錄中出現的禁用名稱抓得到，並指出第幾版；輸出不含命中的文字", () => {
    const pr = post(98, {
      body: "已改正的內容",
      edits: [
        edit("2026-11-02T00:00:00Z", "已改正的內容"),
        edit("2026-11-01T00:00:00Z", `誤貼的 ${NAME_A} 內容`),
        edit("2026-11-01T01:00:00Z", null),
      ],
      reviews: [],
    });
    const result = check({ issues: [], pullRequests: [pr] });
    expect(result.errors).toEqual([]);
    expect(result.findings).toEqual(["PR #98 描述，編輯紀錄第 1 版（2026-11-01T00:00:00Z） 命中禁用名稱清單第 1 項"]);
    const output = JSON.stringify(result.findings).toLowerCase();
    for (const secret of [NAME_A, normalize(NAME_A), "Zephyr", "誤貼"]) expect(output).not.toContain(secret.toLowerCase());
  });

  it("review comment 中的個人路徑、留言的 email 與改名前的標題都抓得到", () => {
    const pr = post(5, {
      reviews: [
        {
          url: "https://github.test/pr/5#review-1",
          body: "",
          edits: [],
          reviewComments: [comment("https://github.test/pr/5#r2", `見 ${HOME_PATH}/kit`)],
        },
      ],
    });
    const issue = post(7, {
      title: "新標題",
      renames: [{ createdAt: "2026-10-01T00:00:00Z", previousTitle: `${NAME_B} 的需求` }],
      comments: [comment("https://github.test/issues/7#c1", `聯絡 ${PERSONAL}`)],
    });
    const result = check({ issues: [issue], pullRequests: [pr] });
    expect(result.findings).toEqual([
      "Issue #7 標題，改名前的標題（2026-10-01T00:00:00Z） 命中禁用名稱清單第 2 項",
      "Issue #7 留言 https://github.test/issues/7#c1 有不在放行清單內的 email",
      "PR #5 review comment https://github.test/pr/5#r2 有個人路徑（/Users/<名稱> 或 /home/<名稱>）",
    ]);
    const output = JSON.stringify(result.findings);
    for (const secret of [NAME_B, PERSONAL, "someone", "corp-mail"]) expect(output).not.toContain(secret);
  });

  it("GitHub Actions 的 /home/runner 與範例格式的 .tld email 不算命中，/home/<其他名稱> 照常命中", () => {
    expect(scanPost(`CI 的路徑是 /home/runner/work/kit/kit，格式 ${at("local", "domain.tld")}`, null)).toEqual([]);
    for (const name of ["someone", "runner2", "runners"]) {
      expect(scanPost(`見 ${["", "home", name, "kit"].join("/")}`, null), name).toEqual([{ kind: "path" }]);
    }
  });

  it("每一層都讀完全部分頁", () => {
    const filler = (n) => Array.from({ length: n }, (_, i) => comment(`https://github.test/c${i}`, "沒問題"));
    const edits = [
      ...Array.from({ length: 4 }, (_, i) => edit(`2026-01-0${i + 1}T00:00:00Z`, "沒問題")),
      edit("2026-01-09T00:00:00Z", NAME_B),
    ];
    const review = () => ({ url: "https://github.test/r", body: "", edits: [], reviewComments: [] });
    const issues = [
      ...Array.from({ length: 4 }, (_, i) => post(i + 1)),
      post(9, { comments: [...filler(3), comment("https://github.test/last", NAME_A)] }),
    ];
    const last = { ...review(), reviewComments: [...filler(3), comment("https://github.test/rc", "", edits)] };
    const prs = [post(10, { reviews: [review(), review(), last] })];
    const result = check({ issues, pullRequests: prs });
    expect(result.findings).toEqual([
      "Issue #9 留言 https://github.test/last 命中禁用名稱清單第 1 項",
      "PR #10 review comment https://github.test/rc，編輯紀錄第 5 版（2026-01-09T00:00:00Z） 命中禁用名稱清單第 2 項",
    ]);
    expect([result.issues, result.pullRequests]).toEqual([5, 1]);
    expect(result.calls.length).toBeGreaterThan(5);
  });

  it("沒有命中時通過；讀取失敗時列為錯誤", () => {
    expect(check({ issues: [post(1)], pullRequests: [post(2, { reviews: [] })] })).toMatchObject({
      errors: [],
      findings: [],
      texts: 4,
    });
    const failing = checkGitHub(process.cwd(), LIST, {
      repo: "owner/repo",
      graphql: () => {
        throw new Error("gh api graphql 失敗：HTTP 502");
      },
    });
    expect(failing.errors).toEqual(["gh api graphql 失敗：HTTP 502"]);
  });

  it("速率限制時等待後重試，超過次數時停止並說明", () => {
    const ok = { status: 0, stdout: JSON.stringify({ data: { ok: true } }), stderr: "" };
    const limited = { status: 1, stdout: "", stderr: "API rate limit exceeded for user ID 1." };
    const replies = [limited, limited, ok];
    const args = [];
    const waits = [];
    const run = (a) => {
      args.push(a);
      return replies.shift();
    };
    const data = ghGraphql("query { ok }", { owner: "o", cursor: null }, { run, sleep: (ms) => waits.push(ms), waitMs: 10 });
    expect(data).toEqual({ ok: true });
    expect(waits).toEqual([10, 10]);
    expect(args[0]).toEqual(["api", "graphql", "-f", "query=query { ok }", "-f", "owner=o"]);
    expect(() => ghGraphql("query { ok }", {}, { run: () => limited, sleep: () => {}, attempts: 2 })).toThrow(/速率限制：重試 2 次/);
    const denied = () => ({ status: 1, stdout: "", stderr: "HTTP 401" });
    expect(() => ghGraphql("query { ok }", {}, { run: denied, sleep: () => {} })).toThrow(/HTTP 401/);
  });

  it("gh 沒有登入時清楚停止", () => {
    const calls = [];
    const notLoggedIn = (a) => {
      calls.push(a);
      return { status: 1, stdout: "", stderr: "not logged in" };
    };
    expect(githubRepo(process.cwd(), notLoggedIn).error).toMatch(/gh auth login/);
    expect(calls).toEqual([["auth", "status"]]);
    const loggedIn = () => ({ status: 0, stdout: "owner/repo\n", stderr: "" });
    expect(githubRepo(process.cwd(), loggedIn)).toEqual({ repo: "owner/repo" });
  });
});
