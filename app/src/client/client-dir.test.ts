import { describe, expect, it } from "vitest";
import { stripComments } from "./source-scan";

// 客戶資料一律經 @client 別名讀取，KK_CLIENT 才切換得到（docs/client-config.md「多客戶與切換」）。
// 以相對路徑指到根目錄的 client/ 會固定讀參考情境；client/schema/ 不隨客戶切換（#77 決定 2），不在此限。
// app/src/client/ 模組（例如 "../client/types"）不是客戶資料，所以依檔案位置解析路徑後再判斷。
const RELATIVE_PATH = /(?:\.\.\/)+client\/[^"'`\s]*/g;
const HERE = "app/src/client/";

// 相對於 repo 根目錄的路徑（只處理 . 與 ..）
function resolvePath(from: string, rel: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function readsRootClient(key: string, text: string): boolean {
  const file = resolvePath(HERE, key);
  return [...stripComments(text).matchAll(RELATIVE_PATH)].some(([rel]) => {
    const target = resolvePath(file, rel.endsWith("/") ? `${rel}.` : rel);
    return (target === "client" || target.startsWith("client/")) && !target.startsWith("client/schema/");
  });
}

const sources = Object.entries(
  import.meta.glob<string>(["../**/*.{ts,tsx}", "../../tests/**/*.ts", "../../../worker/src/**/*.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

const offenders = (files: [string, string][]) => files.filter(([key, text]) => readsRootClient(key, text)).map(([key]) => key);

describe("客戶資料的讀取", () => {
  it("掃描範圍包含 app/src、app/tests 與 worker/src", () => {
    const paths = sources.map(([path]) => path);
    expect(paths).toContain("./load.ts");
    expect(paths.some((p) => p.startsWith("../../tests/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("../../../worker/src/"))).toBe(true);
  });

  it("不以相對路徑讀取根目錄的 client/（只能經 @client）", () => {
    expect(offenders(sources)).toEqual([]);
  });

  it("反向驗證：JSON import、import.meta.glob 與 URL 的字面路徑會被抓到，@client、schema、app 模組與註解不會", () => {
    const up = "../".repeat(3);
    const fake: [string, string][] = [
      ["./import.ts", `import access from "${up}client/access.json";`],
      ["./glob.ts", `const files = import.meta.glob("${up}client/i18n/*.json", { eager: true });`],
      ["../../../worker/src/url.ts", `const dir = new URL("${up.slice(3)}client/", import.meta.url);`],
      ["./alias.ts", `import access from "@client/access.json";`],
      ["./schema.ts", `import schema from "${up}client/schema/client.schema.json";`],
      ["./comment.ts", `// 以前寫成 ${up}client/access.json`],
      ["../ui/module.ts", `import { strings } from "../client/i18n";`],
    ];
    expect(offenders(fake)).toEqual(["./import.ts", "./glob.ts", "../../../worker/src/url.ts"]);
  });
});
