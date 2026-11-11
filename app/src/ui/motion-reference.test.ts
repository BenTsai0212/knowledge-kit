import { describe, expect, it } from "vitest";
import reference from "../../../docs/design/motion-reference.css?raw";
import referenceDoc from "../../../docs/design/motion-reference.md?raw";
import css from "./app.css?raw";

// 動態參考檔（#249）：app.css 中與參考檔同名的 @keyframes 必須照抄；無法照抄的列在 motion-reference.md 的「例外」

// 正規化：去掉註解與多餘空白、數字寫法（.4 與 0.40）、from／to 與 0%／100%、最後一個分號
function normalizeKeyframes(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<![\w.])(-?)(\d*\.?\d+)/g, (_, sign: string, num: string) => String(Number(sign + num)))
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,()])\s*/g, "$1")
    .trim()
    .replace(/(^|[{},])from(?=[{,])/g, "$10%")
    .replace(/(^|[{},])to(?=[{,])/g, "$1100%")
    .replace(/;\}/g, "}");
}

// @keyframes 名稱 → 內容（最外層大括號內）
function keyframesOf(source: string): Map<string, string> {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const result = new Map<string, string>();
  for (const match of text.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    while (depth > 0 && end < text.length) {
      if (text[end] === "{") depth++;
      if (text[end] === "}") depth--;
      end++;
    }
    if (result.has(match[1])) throw new Error(`@keyframes ${match[1]} 重複定義`);
    result.set(match[1], normalizeKeyframes(text.slice(start, end - 1)));
  }
  return result;
}

// motion-reference.md「例外」表：名稱 → 實作的寫法
function exceptionsOf(doc: string): Map<string, string> {
  const section = doc.split(/^## 例外\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const rows = [...section.matchAll(/^\|\s*`([\w-]+)`\s*\|[^|]*\|\s*`([^`]+)`\s*\|\s*$/gm)];
  return new Map(rows.map((m) => [m[1], normalizeKeyframes(m[2])]));
}

const referenceKeyframes = keyframesOf(reference);
const appKeyframes = keyframesOf(css);
const exceptions = exceptionsOf(referenceDoc);

describe("動態參考檔（#249）", () => {
  it("正規化只忽略空白與寫法，不忽略數值", () => {
    expect(normalizeKeyframes("from {\n  opacity: 0;\n  transform: scale(0.40);\n}")).toBe("0%{opacity:0;transform:scale(0.4)}");
    expect(normalizeKeyframes("from{opacity:0;transform:scale(.4)}")).toBe("0%{opacity:0;transform:scale(0.4)}");
    expect(normalizeKeyframes("0%,\n  100% { transform: translate(0, -5px); }")).toBe("0%,100%{transform:translate(0,-5px)}");
    expect(normalizeKeyframes("to{opacity:.55}")).not.toBe(normalizeKeyframes("to{opacity:.5}"));
    expect(normalizeKeyframes("from{transform:translate3d(1px,0,0)}")).toBe("0%{transform:translate3d(1px,0,0)}");
  });

  it("參考檔讀得到全部的 keyframes（不是被 Vitest 換成空字串）", () => {
    expect(referenceKeyframes.size).toBe(33);
    for (const name of ["kSend", "kRise", "kPopS", "kOrbit", "kGlow", "kBump"]) expect(referenceKeyframes.has(name)).toBe(true);
  });

  it("畫布的兩處不一致統一為「AI 問答」的值", () => {
    expect(referenceKeyframes.get("kPopS")).toBe(normalizeKeyframes("from{opacity:0;transform:scale(.4)}"));
    expect(referenceKeyframes.get("kDim")).toBe(normalizeKeyframes("to{opacity:.55}"));
    expect(referenceDoc).toMatch(/`kPopS`[^\n]*統一為 `scale\(\.4\)`/);
    expect(referenceDoc).toMatch(/`kDim`[^\n]*統一為 `\.55`/);
  });

  it("例外表的每一列都是參考檔中的名稱，且 app.css 有實作", () => {
    expect(exceptions.size).toBeGreaterThan(0);
    for (const name of exceptions.keys()) {
      expect(referenceKeyframes.has(name), name).toBe(true);
      expect(appKeyframes.has(name), name).toBe(true);
    }
  });

  it("app.css 中同名的 keyframes 與參考檔相同；例外與「實作的寫法」相同", () => {
    const shared = [...appKeyframes.keys()].filter((name) => referenceKeyframes.has(name));
    expect(shared.length).toBeGreaterThan(0);
    for (const name of shared) {
      const expected = exceptions.get(name) ?? referenceKeyframes.get(name);
      expect(appKeyframes.get(name), name).toBe(expected);
    }
  });

  it("例外只用在確實與參考檔不同的 keyframes", () => {
    for (const [name, implemented] of exceptions) expect(implemented, name).not.toBe(referenceKeyframes.get(name));
  });
});
