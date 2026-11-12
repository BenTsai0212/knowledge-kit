import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { clientConfig } from "./client/load";
import { motionStyleSheet } from "./ui/motion";
import { crossFade } from "./ui/cross-fade";
import { markPresentation, presentationMode } from "./ui/online-demo";
import { startColorScheme, themeStyleSheet } from "./ui/theme";
import "./ui/app.css";

// client/theme.json 的顏色（淺色與深色）、圓角與字型
const style = document.createElement("style");
// 動態的刻度（減少動態效果時為 0ms）
style.textContent = [themeStyleSheet(clientConfig.theme), motionStyleSheet()].join("\n");
document.head.append(style);
// 展示模式（#260）：標記 <html> 放大字級、固定 Light；一般模式依系統設定標記淺色／深色，系統切換時原地交叉淡換（#246）
markPresentation(document.documentElement, presentationMode);
startColorScheme(presentationMode, (query) => window.matchMedia(query), document.documentElement, crossFade);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
