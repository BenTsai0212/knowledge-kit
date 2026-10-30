import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { clientConfig } from "./client/load";
import { themeStyleSheet } from "./ui/theme";
import "./ui/app.css";

// client/theme.json 的顏色（淺色與深色）、圓角與字型
const style = document.createElement("style");
style.textContent = themeStyleSheet(clientConfig.theme);
document.head.append(style);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
