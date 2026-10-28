// useEffect 的函式必須以 { } 包住：寫成 () => expr 時，expr 的回傳值會被 React 當成 cleanup（例如 scrollIntoView 回傳的 Promise），卸載時出錯。
import { expect, it } from "vitest";

it("app/src/ 的 useEffect 一律以 { } 包住函式本體", () => {
  const sources = import.meta.glob<string>("../**/*.tsx", { query: "?raw", import: "default", eager: true });
  expect(Object.keys(sources).length).toBeGreaterThan(5);
  const bad = Object.entries(sources).filter(([, text]) => /useEffect\(\s*\(\)\s*=>\s*[^{\s]/.test(text));
  expect(bad.map(([path]) => path)).toEqual([]);
});
