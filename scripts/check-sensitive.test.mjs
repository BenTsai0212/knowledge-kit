import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_NAMES_FILE, NAMES_ENV, addedLines, findEmails, isAllowedEmail, normalize, parseNames } from "./check-sensitive.mjs";

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
    ]) {
      expect(isAllowedEmail(address), address).toBe(true);
    }
    for (const address of [PERSONAL, at("ops", "notexample.com"), at("ops", "example.com.tw"), at("no-reply", "corp-mail.com")]) {
      expect(isAllowedEmail(address), address).toBe(false);
    }
    expect(findEmails(`"vite": "${at("npm:vite", "8.3.5")}"`)).toEqual([]);
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
