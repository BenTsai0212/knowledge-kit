import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { clientConfig } from "./client/load";
import { themeVariables } from "./ui/theme";
import "./ui/app.css";

// client/theme.json 的顏色、圓角與字型
const root = document.documentElement.style;
for (const [name, value] of Object.entries(themeVariables(clientConfig.theme))) root.setProperty(name, value);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
