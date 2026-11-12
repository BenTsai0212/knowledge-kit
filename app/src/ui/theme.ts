// client/theme.json → CSS 變數（--color-*、--radius-*、--font-*）。app.css 只透過這些變數取得顏色與圓角。
// 深色模式：依系統設定（prefers-color-scheme）在 <html> 標上 data-scheme，darkColors 放在 :root[data-scheme="dark"] 內。
// 由 JS 標記而不是直接用 media query，系統切換時才能拍下舊畫面做交叉淡換（#246，main.tsx 的 followColorScheme()）。
import type { ThemeColors, ThemeFile } from "../client/types";

export const DARK_SCHEME = "(prefers-color-scheme: dark)";
export const SCHEME_ATTRIBUTE = "data-scheme";
// app.css 的深色規則都寫在這個選擇器的巢狀區塊內
export const DARK_SELECTOR = `:root[${SCHEME_ATTRIBUTE}="dark"]`;

function colorVariables(colors: ThemeColors): Record<string, string> {
  return Object.fromEntries(Object.entries(colors).map(([name, value]) => [`--color-${name}`, value]));
}

// 淺色的所有變數
export function themeVariables(theme: ThemeFile): Record<string, string> {
  return {
    ...colorVariables(theme.colors),
    ...Object.fromEntries(Object.entries(theme.radius).map(([name, value]) => [`--radius-${name}`, value])),
    ...Object.fromEntries(Object.entries(theme.fonts).map(([name, value]) => [`--font-${name}`, value])),
  };
}

const declarations = (variables: Record<string, string>) =>
  Object.entries(variables)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");

// main.tsx 放進 <style> 的內容
export function themeStyleSheet(theme: ThemeFile): string {
  return [
    `:root { color-scheme: light; ${declarations(themeVariables(theme))} }`,
    `${DARK_SELECTOR} { color-scheme: dark; ${declarations(colorVariables(theme.darkColors))} }`,
  ].join("\n");
}

export const isDark = (root: Pick<Element, "getAttribute">): boolean => root.getAttribute(SCHEME_ATTRIBUTE) === "dark";

// 依系統設定標記 root；系統切換時把重新標記交給 change（交叉淡換）。回傳取消監聽的函式
export function followColorScheme(
  matchMedia: (query: string) => MediaQueryList,
  root: Pick<Element, "setAttribute">,
  change: (apply: () => void) => void,
): () => void {
  const query = matchMedia(DARK_SCHEME);
  const apply = () => root.setAttribute(SCHEME_ATTRIBUTE, query.matches ? "dark" : "light");
  apply();
  const listener = () => change(apply);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

// 展示模式（#260，docs/design.md「字級與主題」）：預設 Light、不跟隨系統（投影機在有燈光的會議室裡，深色畫面容易灰掉）。
// 一般模式依系統設定（followColorScheme）。回傳取消監聽的函式
export function startColorScheme(
  presentation: boolean,
  matchMedia: (query: string) => MediaQueryList,
  root: Pick<Element, "setAttribute">,
  change: (apply: () => void) => void,
): () => void {
  if (!presentation) return followColorScheme(matchMedia, root, change);
  root.setAttribute(SCHEME_ATTRIBUTE, "light");
  return () => {};
}

// root 的淺色／深色標記改變後呼叫 onChange（例如重新套用 cytoscape 的配色）；回傳取消監聽的函式
export function watchColorScheme(root: Node, onChange: () => void, Observer: typeof MutationObserver = MutationObserver): () => void {
  const observer = new Observer(() => onChange());
  observer.observe(root, { attributes: true, attributeFilter: [SCHEME_ATTRIBUTE] });
  return () => observer.disconnect();
}
