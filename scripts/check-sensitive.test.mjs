import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_NAMES_FILE, NAMES_ENV, findEmails, isAllowedEmail, normalize, parseNames } from "./check-sensitive.mjs";

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
