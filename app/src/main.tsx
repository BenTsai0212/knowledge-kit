import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { clientConfig } from "./client/load";
import "./ui/app.css";

// client/theme.json 的顏色與字型（正式的主題在 Epic 第 11 項）
const { colors, fonts } = clientConfig.theme;
const root = document.documentElement.style;
for (const [name, value] of Object.entries(colors)) root.setProperty(`--color-${name}`, value);
root.setProperty("--font-body", fonts.body);
root.setProperty("--font-heading", fonts.heading);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
