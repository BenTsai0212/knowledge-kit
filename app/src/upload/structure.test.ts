// 結構測試（#38 決定）：
// - pdfjs-dist 6.x 已移除 CVE-2024-4367 所在的 eval 路徑與 isEvalSupported 選項；確認安裝的版本沒有 eval 與 Function()，升級時若重新加入，CI 失敗
// - 上傳模組只擷取文字：不繪製 PDF 頁面，也不寫 isEvalSupported（避免誤以為有防護）；Word 只用 extractRawText
import legacyMain from "pdfjs-dist/legacy/build/pdf.mjs?raw";
import legacyWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?raw";
import main from "pdfjs-dist/build/pdf.mjs?raw";
import worker from "pdfjs-dist/build/pdf.worker.mjs?raw";
import { describe, expect, it } from "vitest";

// eval(…)、Function(…)、new Function(…)；不誤判 FunctionBasedShading 這類識別字的一部分
const EVAL = /(?<![\w$])(?:eval|Function)\s*\(/;
// legacy 版內含 core-js 的 globalThis 後備寫法（固定字串，不是 CVE-2024-4367 的字型路徑）；只放行這一段完全相同的寫法。
// 瀏覽器使用的 build/ 版本沒有任何例外
const CORE_JS_GLOBAL = "(function () { return this; })() || Function('return this')();";
const evalIn = (text: string, allowCoreJs: boolean) => (allowCoreJs ? text.split(CORE_JS_GLOBAL).join("") : text).match(EVAL)?.[0] ?? null;

const sources = Object.entries(import.meta.glob<string>("./*.ts", { query: "?raw", import: "default", eager: true })).filter(
  ([path]) => !path.endsWith(".test.ts"),
);
const FORBIDDEN = [/\brender\s*\(/, /\bgetContext\s*\(/, /canvas/i, /isEvalSupported/, /convertToHtml|convertToMarkdown/];

describe("PDF.js 沒有 eval 路徑", () => {
  it("規則能抓到 eval 與 Function()，不誤判識別字", () => {
    for (const bad of ['new Function("x")', 'Function("x")', 'eval("x")', "x = eval (y)"]) expect(EVAL.test(bad), bad).toBe(true);
    for (const ok of ["new FunctionBasedShading(dict)", "isFunction(x)", "evaluate(x)", "PostScriptFunction(x)", "typeof Function"]) {
      expect(EVAL.test(ok), ok).toBe(false);
    }
  });

  it("例外只限 core-js 的那一段：其他 Function() 仍會被抓到", () => {
    expect(evalIn(`x = ${CORE_JS_GLOBAL}`, true)).toBeNull();
    expect(evalIn(`x = ${CORE_JS_GLOBAL}`, false)).toBe("Function(");
    expect(evalIn(`${CORE_JS_GLOBAL} new Function("a", "return a")`, true)).toBe("Function(");
  });

  it.each([
    ["build/pdf.mjs", main, false],
    ["build/pdf.worker.mjs", worker, false],
    ["legacy/build/pdf.mjs", legacyMain, true],
    ["legacy/build/pdf.worker.mjs", legacyWorker, true],
  ])("pdfjs-dist/%s 沒有 eval 與 Function()", (_name, text, allowCoreJs) => {
    expect(text.length).toBeGreaterThan(100_000);
    expect(evalIn(text, allowCoreJs)).toBeNull();
  });
});

describe("上傳模組只擷取文字", () => {
  it("掃描範圍包含 app/src/upload/ 的程式", () => {
    expect(sources.map(([path]) => path)).toEqual(expect.arrayContaining(["./pdf.ts", "./docx.ts", "./parse.ts"]));
  });

  it("沒有繪製 PDF 頁面、isEvalSupported 或 mammoth 的 HTML 轉換", () => {
    expect(sources.flatMap(([path, text]) => FORBIDDEN.filter((re) => re.test(text)).map((re) => `${path} ${re}`))).toEqual([]);
  });

  it("PDF 只呼叫 getTextContent；Word 只用 extractRawText", () => {
    const text = Object.fromEntries(sources);
    expect(text["./pdf.ts"]).toContain("getTextContent()");
    expect(text["./docx.ts"]).toContain("extractRawText(");
  });
});
