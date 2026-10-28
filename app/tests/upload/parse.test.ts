// 上傳文件的解析：純文字（含貼上）、Markdown、PDF、Word 與各種固定錯誤。fixture 在測試中產生，內容虛構（#38 決定 4）。
import { describe, expect, it } from "vitest";
import { extractDocxText } from "../../src/upload/docx";
import { extractText, formatOf, MAX_FILE_BYTES, MAX_TEXT_CHARS, type Extractors } from "../../src/upload/parse";
import { extractPdfText } from "../../src/upload/pdf";
import { makeDocx, makePdf } from "./fixtures";

// Node 中使用 PDF.js 的 legacy 版本；mammoth 的 Node 版只接受 buffer（瀏覽器版只接受 arrayBuffer），在這裡轉換
const NODE: Extractors = {
  pdf: (data) => extractPdfText(data, () => import("pdfjs-dist/legacy/build/pdf.mjs")),
  docx: (data) =>
    extractDocxText(data, async () => {
      const mammoth = (await import("mammoth")).default;
      return {
        extractRawText: (input) =>
          mammoth.extractRawText({ buffer: new Uint8Array((input as { arrayBuffer: ArrayBuffer }).arrayBuffer) as never }),
      };
    }),
};
const encode = (text: string) => new TextEncoder().encode(text);
const parse = (data: Uint8Array, format: Parameters<typeof extractText>[1]) => extractText(data, format, NODE);

describe("formatOf", () => {
  it("依副檔名判斷格式，不分大小寫；不支援的回 null", () => {
    expect(["a.txt", "b.MD", "c.markdown", "d.Pdf", "e.docx"].map(formatOf)).toEqual(["text", "markdown", "markdown", "pdf", "docx"]);
    expect(["f.doc", "g.pptx", "h", "i.txt.exe"].map(formatOf)).toEqual([null, null, null, null]);
  });
});

describe("extractText", () => {
  it("純文字（含貼上）：原文，換行統一為 \\n，去掉前後空白", async () => {
    expect(await parse(encode("  範例公司的虛構公告。\r\n\r\nFictional notice.  "), "text")).toBe("範例公司的虛構公告。\n\nFictional notice.");
  });

  it("Markdown：去掉語法符號，留下純文字", async () => {
    const md = "# 虛構週報\n\n- 青翼桌**試用**完成\n- 見[附件](https://example.com/a)\n\n![圖](x.png)";
    expect(await parse(encode(md), "markdown")).toBe("虛構週報\n\n青翼桌試用完成\n見附件");
  });

  it("PDF：逐頁擷取文字，行依 hasEOL 分開，頁與頁之間以空行分隔", async () => {
    const pdf = makePdf([["Example Co. plans a fictional field trial.", "The trial ends in May."], ["Second page of fictional notes."]]);
    expect(await parse(pdf, "pdf")).toBe("Example Co. plans a fictional field trial.\nThe trial ends in May.\n\nSecond page of fictional notes.");
  });

  it("Word：以 extractRawText 擷取，段落之間以空行分隔", async () => {
    expect(await parse(makeDocx(["虛構的會議紀錄。", "Fictional meeting notes & <tags>."]), "docx")).toBe(
      "虛構的會議紀錄。\n\nFictional meeting notes & <tags>.",
    );
  });

  it("PDF 沒有文字（掃描檔）→ no_text；其他格式沒有文字 → empty", async () => {
    await expect(parse(makePdf([[]]), "pdf")).rejects.toMatchObject({ reason: "no_text" });
    await expect(parse(encode(" \n\n "), "text")).rejects.toMatchObject({ reason: "empty" });
    await expect(parse(encode("![](x.png)"), "markdown")).rejects.toMatchObject({ reason: "empty" });
    await expect(parse(makeDocx([""]), "docx")).rejects.toMatchObject({ reason: "empty" });
  });

  it("檔案超過 10 MB → too_large；擷取後超過 50,000 字元 → too_long", async () => {
    await expect(parse(new Uint8Array(MAX_FILE_BYTES + 1), "text")).rejects.toMatchObject({ reason: "too_large" });
    await expect(parse(encode("字".repeat(MAX_TEXT_CHARS + 1)), "text")).rejects.toMatchObject({ reason: "too_long" });
    expect(await parse(encode("字".repeat(MAX_TEXT_CHARS)), "text")).toHaveLength(MAX_TEXT_CHARS);
  });

  it("損毀的檔案 → failed", async () => {
    await expect(parse(encode("not a pdf"), "pdf")).rejects.toMatchObject({ reason: "failed" });
    await expect(parse(encode("not a zip"), "docx")).rejects.toMatchObject({ reason: "failed" });
  });
});
