// 實體類型的固定圖示集（#199）：24×24 的單色 SVG path，以 evenodd 挖出內部的線條。
// knowledge-model.json 的 entityTypes[].icon 從這裡挑選（Schema 的 enum 與這裡的鍵相同，entity-icons.test.ts 比對）。
// cytoscape 的節點以 iconDataUri() 當 background-image；圖例與面板以 EntityIcon.tsx 畫同一份 path。
import type { EntityIconName } from "../client/types";

export const ENTITY_ICONS: Record<EntityIconName, string> = {
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z",
  team:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7.5 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 13c-3.6 0-7 1.8-7 4.5V20h14v-2.5c0-2.7-3.4-4.5-7-4.5zm7.5 0c-.6 0-1.1 0-1.6.1 1.3.9 2.1 2 2.1 3.4V20h5v-2.5c0-2.7-3-4.5-5.5-4.5z",
  building:
    "M4 21V3h11v6h5v12h-7v-4h-2v4zM7 6v2h2V6zm4 0v2h2V6zm-4 4v2h2v-2zm4 0v2h2v-2zm-4 4v2h2v-2zm4 0v2h2v-2zm5-2v2h2v-2zm0 4v2h2v-2z",
  folder: "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
  box: "M12 2 3 6.5v11l9 4.5 9-4.5v-11zm0 2.2 6.6 3.3-6.6 3.3-6.6-3.3zM5 9.1l6 3v7.6l-6-3zm8 10.6v-7.6l6-3v7.6z",
  factory: "M2 21V11l6-3v3l6-3v3l2-1V3h4v18zm3-6v2h2v-2zm5 0v2h2v-2zm5 0v2h2v-2z",
  handshake:
    "M1 10.5 5 6.5l3.5 1L11 6h3l4.5 2.5L23 7v6.5l-3 1-5.5 4.5a2 2 0 0 1-2.8 0l-.7-.7-.8.7a2 2 0 0 1-2.8-.6L4.5 16 1 14.5zm8.5-2.2L7 10.5l1.5 1.5 3-2 4.5 4 1.5-1.5-4.8-4.2z",
  hospital: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm6 4v3H7v4h3v3h4v-3h3v-4h-3V7z",
  gavel: "M14.5 2 21 8.5 18.5 11 17 9.5 13.5 13l1.5 1.5L12.5 17 6 10.5 8.5 8 10 9.5 13.5 6 12 4.5zM9.5 14.5 11 16l-6.5 6.5L3 21zM13 20h9v2h-9z",
  document: "M6 2h8l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm7 1.5V8h4.5zM8 12v1.5h8V12zm0 3.5V17h8v-1.5z",
  generic: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10z",
};

// 給 cytoscape 的 background-image：圖示以 color 著色（#RRGGBB）
export function iconDataUri(icon: EntityIconName, color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<path fill="${color}" fill-rule="evenodd" d="${ENTITY_ICONS[icon]}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
