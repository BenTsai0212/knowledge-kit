import { describe, expect, it } from "vitest";
import { chunk, SHORT_PARAGRAPH_CHARS } from "./chunk";
import { MAX_PASSAGES } from "./parse";

describe("chunk", () => {
  it("以空行分段；段落內的換行在漢字之間直接相連，其他換成空白", () => {
    expect(chunk("範例公司的虛構公告，\n說明青翼桌的試用安排。\n\nThe trial\nends in May with a short review.", 300)).toEqual([
      "範例公司的虛構公告，說明青翼桌的試用安排。",
      "The trial ends in May with a short review.",
    ]);
  });

  it(`很短的段落（${SHORT_PARAGRAPH_CHARS} 字元內，例如標題）併入下一段`, () => {
    const body = "青翼桌的試用已經完成，下週會整理使用者的回饋並提出改善建議。";
    expect(chunk(`虛構週報\n\n第一節\n\n${body}`, 300)).toEqual([`虛構週報 第一節 ${body}`]);
    // 最後一段很短時保留
    expect(chunk(`${body}\n\n附註`, 300)).toEqual([body, "附註"]);
  });

  it("超過上限的段落依句尾斷開（中文與英文）", () => {
    const zh = "第一句是虛構的內容。第二句也是虛構的。第三句說明試用的安排！";
    expect(chunk(zh, 20)).toEqual(["第一句是虛構的內容。第二句也是虛構的。", "第三句說明試用的安排！"]);
    const en = "The first sentence is fictional. The second one is too! Is the third one a question?";
    expect(chunk(en, 60)).toEqual(["The first sentence is fictional. The second one is too!", "Is the third one a question?"]);
  });

  it("單句仍超過上限時硬切；長度以字元計算", () => {
    expect(chunk("青".repeat(25), 10)).toEqual(["青".repeat(10), "青".repeat(10), "青".repeat(5)]);
    expect(chunk("😀".repeat(12), 10)).toEqual(["😀".repeat(10), "😀".repeat(2)]);
  });

  it("每段都不超過上限", () => {
    const text = Array.from({ length: 30 }, (_, i) => `這是第 ${i} 句虛構的說明，用來測試切段。`).join("") + "\n\n" + "Fictional sentence. ".repeat(40);
    for (const max of [100, 300, 1000]) {
      const passages = chunk(text, max);
      expect(passages.every((p) => [...p].length <= max), String(max)).toBe(true);
      expect(passages.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
    }
  });

  it("段落數超過上限 → too_long；空白文字沒有段落", () => {
    const many = Array.from({ length: MAX_PASSAGES + 1 }, (_, i) => `這是第 ${i} 段虛構的內容，長度超過二十個字元。`).join("\n\n");
    expect(() => chunk(many, 300)).toThrow(expect.objectContaining({ reason: "too_long" }));
    expect(chunk(" \n\n ", 300)).toEqual([]);
  });
});
