import { describe, expect, it } from "vitest";
import { stripMarkdown } from "./markdown";

describe("stripMarkdown", () => {
  it("去掉標題、引用、清單、分隔線的符號", () => {
    expect(stripMarkdown("## 虛構標題\n> 引用的句子\n- 第一項\n2. 第二項\n\n---")).toBe("虛構標題\n引用的句子\n第一項\n第二項\n\n");
  });

  it("連結只留文字，圖片整個去掉", () => {
    expect(stripMarkdown("見[虛構附件](https://example.com/a)與![示意圖](a.png)。")).toBe("見虛構附件與。");
  });

  it("去掉強調與行內程式碼的符號，保留程式碼區塊的內容", () => {
    expect(stripMarkdown("**粗體**、*斜體*、`code`\n```js\nconst x = 1;\n```")).toBe("粗體、斜體、code\n\nconst x = 1;\n");
  });

  it("不轉成 HTML：原文中的標籤保留為文字", () => {
    expect(stripMarkdown("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});
