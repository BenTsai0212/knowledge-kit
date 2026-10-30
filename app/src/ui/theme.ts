// client/theme.json → CSS 變數（--color-*、--radius-*、--font-*）。app.css 只透過這些變數取得顏色與圓角。
import type { ThemeFile } from "../client/types";

export function themeVariables(theme: ThemeFile): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(theme.colors).map(([name, value]) => [`--color-${name}`, value])),
    ...Object.fromEntries(Object.entries(theme.radius).map(([name, value]) => [`--radius-${name}`, value])),
    "--font-body": theme.fonts.body,
    "--font-heading": theme.fonts.heading,
  };
}
