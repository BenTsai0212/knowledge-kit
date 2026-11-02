import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 文件中的 shell 指令區塊不加 # 註解：macOS 的 zsh 預設不把互動輸入的 # 當註解，照著複製會出錯（#100 PR 3 的修改要求）
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHELL_LANGS = new Set(["", "bash", "sh", "zsh", "shell", "console"]);

// 回傳 shell 區塊中含 # 註解的行（行首或空白後的 #）
function shellComments(text) {
  const found = [];
  let lang = null;
  text.split("\n").forEach((line, i) => {
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      lang = lang === null ? fence[1] : null;
      return;
    }
    if (lang !== null && SHELL_LANGS.has(lang) && /(^|\s)#/.test(line)) found.push(`${i + 1}: ${line.trim()}`);
  });
  return found;
}

describe("shellComments", () => {
  it("找出行尾與整行的註解", () => {
    const text = ["```bash", "npm test   # 註解", "# 整行", "npm run build", "```"].join("\n");
    expect(shellComments(text)).toEqual(["2: npm test   # 註解", "3: # 整行"]);
  });

  it("不檢查區塊外的文字、其他語言的區塊與參數中的 #", () => {
    const text = ["# 標題", "```json", '{ "a": "# x" }', "```", "```bash", "gh issue view N --jq '.a#b'", "```"].join("\n");
    expect(shellComments(text)).toEqual([]);
  });
});

describe("repo 內的 Markdown", () => {
  const files = execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

  it("shell 指令區塊沒有 # 註解", () => {
    const problems = files.flatMap((file) =>
      shellComments(readFileSync(`${ROOT}${file}`, "utf8")).map((line) => `${file}:${line}`),
    );
    expect(problems).toEqual([]);
  });
});
