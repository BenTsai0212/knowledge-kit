// 結構測試共用（i18n.test.ts、ui/theme.test.ts）：app/src/ 的原始碼（不含測試），以及去掉註解的函式。
// 鍵是相對於本檔的路徑（例如 "../App.tsx"、"./i18n.ts"）。

export const sources = Object.entries(
  import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts"], { query: "?raw", import: "default", eager: true }),
);

// 去掉註解，保留字串、樣板字串、正規表達式與 JSX 文字（略過其中的 //、/* 與引號）
export function stripComments(text: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === quote) quote = null;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "/" && /(^|[(,=:[!&|?{};]|\breturn)\s*$/.test(out.slice(-20))) {
      // 正規表達式：讀到字元類別外、未跳脫的 /
      let inClass = false;
      out += c;
      for (i++; i < text.length && text[i] !== "\n"; i++) {
        const r = text[i];
        out += r;
        if (r === "\\") out += text[++i] ?? "";
        else if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
      }
    } else {
      if (c === '"' || c === "'" || c === "`") quote = c;
      out += c;
    }
  }
  return out;
}
