// 畫面的結構規則。
// useEffect 的函式必須以 { } 包住：寫成 () => expr 時，expr 的回傳值會被 React 當成 cleanup（例如 scrollIntoView 回傳的 Promise），卸載時出錯。
import { expect, it } from "vitest";

it("app/src/ 的 useEffect 一律以 { } 包住函式本體", () => {
  const sources = import.meta.glob<string>("../**/*.tsx", { query: "?raw", import: "default", eager: true });
  expect(Object.keys(sources).length).toBeGreaterThan(5);
  const bad = Object.entries(sources).filter(([, text]) => /useEffect\(\s*\(\)\s*=>\s*[^{\s]/.test(text));
  expect(bad.map(([path]) => path)).toEqual([]);
});

// 上傳的內容一律以文字節點顯示（#38）：不使用 dangerouslySetInnerHTML
it("app/src/ 不使用 dangerouslySetInnerHTML", () => {
  const sources = import.meta.glob<string>("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
  const files = Object.entries(sources).filter(([path]) => !path.endsWith(".test.ts"));
  expect(files.length).toBeGreaterThan(10);
  expect(files.filter(([, text]) => text.includes("dangerouslySetInnerHTML")).map(([path]) => path)).toEqual([]);
});
