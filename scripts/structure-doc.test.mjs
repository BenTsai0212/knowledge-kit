import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// docs/structure.md 一個檔案一行（#314）：平行的 PR 改到同一行就會衝突，有衝突的 PR 不會觸發 CI（ADR 0010）。
// 每個 ### 小節底下的清單一行一個檔案、依檔名排序；新增檔案時只插入一行。寫法見 docs/structure.md「寫法」。
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOC = "docs/structure.md";
export const MAX_LINE = 300;

/** 清單一行的排序鍵：第一個行內程式碼，不分大小寫。 */
export function sortKey(line) {
  const m = /^- `([^`]+)`/.exec(line);
  return m ? m[1].toLowerCase() : null;
}

/** 依 ### 小節分出清單的行（只看行首的 `- `）。 */
export function sections(markdown) {
  const out = [];
  let current = null;
  markdown.split("\n").forEach((text, i) => {
    const heading = /^###\s+(.+?)\s*$/.exec(text);
    if (heading) {
      current = { title: heading[1], items: [] };
      out.push(current);
    } else if (/^#{1,2}\s/.test(text)) {
      current = null;
    } else if (current && text.startsWith("- ")) {
      current.items.push({ line: i + 1, text });
    }
  });
  return out;
}

/** 違反寫法的地方，每項是給人看的訊息。 */
export function problems(markdown) {
  const found = [];
  for (const { title, items } of sections(markdown)) {
    items.forEach(({ line, text }, i) => {
      const length = [...text].length;
      if (length > MAX_LINE) {
        found.push(`第 ${line} 行（${title}）有 ${length} 字，上限 ${MAX_LINE}：把細節寫到 docs/ 的對應文件，這裡只留一句說明與連結`);
      }
      const key = sortKey(text);
      if (key === null) {
        found.push(`第 ${line} 行（${title}）不是「- \`檔名\`：說明」的格式：每行以檔名的行內程式碼開頭`);
        return;
      }
      const prev = i > 0 ? sortKey(items[i - 1].text) : null;
      if (prev !== null && prev > key) {
        found.push(`第 ${line} 行（${title}）的 \`${key}\` 應排在第 ${items[i - 1].line} 行的 \`${prev}\` 之前：清單依檔名排序（不分大小寫、依字元碼），把這一行移到正確的位置`);
      }
    });
  }
  return found;
}

describe("docs/structure.md 的寫法（#314）", () => {
  const markdown = readFileSync(join(ROOT, DOC), "utf8");

  it("每個小節的清單一行不超過 300 字、依檔名排序", () => {
    expect(problems(markdown), `${DOC}：\n${problems(markdown).join("\n")}`).toEqual([]);
  });

  it("有路徑的小節與檔案清單", () => {
    const all = sections(markdown);
    expect(all.map((s) => s.title)).toContain("`app/src/ui/`");
    expect(all.reduce((n, s) => n + s.items.length, 0)).toBeGreaterThan(100);
  });

  it("清單列出的檔案存在（萬用字元與 <名稱> 之類的佔位除外）", () => {
    const missing = [];
    for (const { title, items } of sections(markdown)) {
      const base = /^`(.+)`$/.exec(title)?.[1] ?? "";
      for (const { line, text } of items) {
        const name = /^- `([^`]+)`/.exec(text)?.[1];
        if (!name || /[*<]/.test(name)) continue;
        if (!existsSync(join(ROOT, base, name))) missing.push(`第 ${line} 行：${base}${name}`);
      }
    }
    expect(missing, `${DOC} 列出的檔案不存在（改名或刪除時一併修改那一行）：\n${missing.join("\n")}`).toEqual([]);
  });
});

describe("problems()", () => {
  it("抓出太長、沒排序與格式不對的行", () => {
    const md = [
      "### `a/`",
      "",
      "- `b.ts`：說明",
      "- `A.ts`：說明",
      `- \`c.ts\`：${"字".repeat(MAX_LINE)}`,
      "- 沒有檔名",
      "## 其他",
      "- `z`：不在小節裡，不檢查",
    ].join("\n");
    const found = problems(md);
    expect(found).toHaveLength(3);
    expect(found[0]).toMatch(/第 4 行.*`a\.ts` 應排在第 3 行的 `b\.ts` 之前/);
    expect(found[1]).toMatch(/第 5 行.*上限 300/);
    expect(found[2]).toMatch(/第 6 行.*不是「- `檔名`：說明」的格式/);
  });

  it("不分大小寫，- 與 . 排在英文字母前", () => {
    const md = ["### `ui/`", "- `access-code.ts`：x", "- `AccessBadges.tsx`：x", "- `graph-list.ts`：x", "- `GraphList.tsx`：x", "- `script.ts`：x", "- `ScriptPanel.tsx`：x"].join("\n");
    expect(problems(md)).toEqual([]);
  });
});
