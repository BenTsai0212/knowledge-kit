// client/theme.json → CSS 變數（--color-*、--radius-*、--font-*）。app.css 只透過這些變數取得顏色與圓角。
// 深色模式：darkColors 放在 @media (prefers-color-scheme: dark) 內，依系統設定切換，不需要 JS 判斷。
import type { ThemeColors, ThemeFile } from "../client/types";

export const DARK_SCHEME = "(prefers-color-scheme: dark)";

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
    `:root { color-scheme: light dark; ${declarations(themeVariables(theme))} }`,
    `@media ${DARK_SCHEME} { :root { ${declarations(colorVariables(theme.darkColors))} } }`,
  ].join("\n");
}

// 系統的淺色／深色切換時呼叫 onChange（例如重新套用 cytoscape 的配色）；回傳取消監聽的函式
export function watchColorScheme(matchMedia: (query: string) => MediaQueryList, onChange: () => void): () => void {
  const query = matchMedia(DARK_SCHEME);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
