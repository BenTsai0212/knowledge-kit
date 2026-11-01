import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// docs/playbook/（繁中）與 docs/playbook/en/（英文）內容一致（#68）
const PLAYBOOK = fileURLToPath(new URL("../docs/playbook/", import.meta.url));

const mdFiles = (dir) => readdirSync(dir).filter((name) => name.endsWith(".md")).sort();

// 去掉 ``` 圍起的程式碼區塊，避免把範例當成標題或連結
const prose = (text) => text.replace(/^```[\s\S]*?^```/gm, "");

const h2Count = (text) => prose(text).split("\n").filter((line) => line.startsWith("## ")).length;

// 相對連結（不含 http(s)、mailto 與頁內錨點）的目標路徑
const relativeLinks = (text) =>
  [...prose(text).matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1].split("#")[0])
    .filter((target) => target && !/^[a-z]+:/i.test(target));

// 回傳問題清單；空陣列表示通過
function checkPlaybook(root) {
  const zhDir = root;
  const enDir = join(root, "en");
  const errors = [];
  const zh = mdFiles(zhDir);
  const en = mdFiles(enDir);
  for (const name of zh.filter((n) => !en.includes(n))) errors.push(`en/${name} 不存在`);
  for (const name of en.filter((n) => !zh.includes(n))) errors.push(`${name} 不存在（只有 en/${name}）`);
  for (const name of zh.filter((n) => en.includes(n))) {
    const a = h2Count(readFileSync(join(zhDir, name), "utf8"));
    const b = h2Count(readFileSync(join(enDir, name), "utf8"));
    if (a !== b) errors.push(`${name} 的 ## 標題數量不同：繁中 ${a}、英文 ${b}`);
  }
  for (const [dir, names, prefix] of [[zhDir, zh, ""], [enDir, en, "en/"]]) {
    for (const name of names) {
      for (const target of relativeLinks(readFileSync(join(dir, name), "utf8"))) {
        if (!existsSync(resolve(dir, target))) errors.push(`${prefix}${name} 的連結 ${target} 指向不存在的檔案`);
      }
    }
  }
  return errors;
}

describe("docs/playbook", () => {
  const roots = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  // 複製到暫存目錄（保留 ../client-config.md 等連結的相對位置）
  function copy() {
    const root = mkdtempSync(join(tmpdir(), "playbook-"));
    roots.push(root);
    const docs = dirname(PLAYBOOK.replace(/\/$/, ""));
    cpSync(docs, join(root, "docs"), { recursive: true });
    return join(root, "docs", "playbook");
  }

  it("繁中與英文的檔名、## 標題數量相同，相對連結都存在", () => {
    expect(mdFiles(PLAYBOOK).length).toBeGreaterThan(0);
    expect(checkPlaybook(PLAYBOOK)).toEqual([]);
  });

  it("刪掉一份英文檔時失敗", () => {
    const root = copy();
    unlinkSync(join(root, "en", "data-security.md"));
    expect(checkPlaybook(root)).toContain("en/data-security.md 不存在");
  });

  it("刪掉一個 ## 標題時失敗", () => {
    const root = copy();
    const file = join(root, "en", "acceptance-metrics.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^## /m, "### "));
    expect(checkPlaybook(root).some((e) => e.startsWith("acceptance-metrics.md 的 ## 標題數量不同"))).toBe(true);
  });

  it("相對連結指向不存在的檔案時失敗", () => {
    const root = copy();
    unlinkSync(join(root, "..", "evals.md"));
    expect(checkPlaybook(root)).toEqual(
      expect.arrayContaining([
        "eval-question-bank.md 的連結 ../evals.md 指向不存在的檔案",
        "en/eval-question-bank.md 的連結 ../../evals.md 指向不存在的檔案",
      ]),
    );
  });
});
