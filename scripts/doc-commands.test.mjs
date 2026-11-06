import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 文件中的 shell 指令區塊不加 # 註解：macOS 的 zsh 預設不把互動輸入的 # 當註解，照著複製會出錯（#100 PR 3 的修改要求）
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHELL_LANGS = new Set(["", "bash", "sh", "zsh", "shell", "console"]);

// 一行中是否有 # 註解：行首或空白後、不在引號內的 #；#! 開頭的行不算（判斷方式取自 template 的同名測試，#136）
function hasComment(line) {
  if (/^\s*#!/.test(line)) return false;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === "\\") {
      i++;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return true;
    }
  }
  return false;
}

// 回傳 shell 區塊中含 # 註解的行
function shellComments(text) {
  const found = [];
  let lang = null;
  text.split("\n").forEach((line, i) => {
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      lang = lang === null ? fence[1] : null;
      return;
    }
    if (lang !== null && SHELL_LANGS.has(lang) && hasComment(line)) found.push(`${i + 1}: ${line.trim()}`);
  });
  return found;
}

describe("shellComments", () => {
  it("找出行尾與整行的註解", () => {
    const text = ["```bash", "npm test   # 註解", "# 整行", "  # 縮排的整行", "npm run build", "```"].join("\n");
    expect(shellComments(text)).toEqual(["2: npm test   # 註解", "3: # 整行", "4: # 縮排的整行"]);
  });

  it("不檢查區塊外的文字、其他語言的區塊與參數中的 #", () => {
    const text = ["# 標題", "```json", '{ "a": "# x" }', "```", "```bash", "gh issue view N --jq '.a#b'", "```"].join("\n");
    expect(shellComments(text)).toEqual([]);
  });

  it("#!、引號內與網址中的 # 不算；引號之後的照常算", () => {
    const text = [
      "```bash",
      "#!/usr/bin/env bash",
      "gh issue view N --jq '.a #b'",
      "echo \"a # b\" 'c # d' \"e \\\" # f\"",
      "curl https://example.com/page#section",
      "echo ${#arr[@]} a#b \\#c",
      "echo 'a' # 引號之後的註解",
      "```",
    ].join("\n");
    expect(shellComments(text)).toEqual(["7: echo 'a' # 引號之後的註解"]);
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
