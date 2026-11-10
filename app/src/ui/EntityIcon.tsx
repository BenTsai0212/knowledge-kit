// 實體類型的圖示（圖例與面板）：與 cytoscape 節點相同的 path，旁邊一律有類型名稱的文字，所以對輔助技術隱藏
import type { EntityIconName } from "../client/types";
import { ENTITY_ICONS } from "./entity-icons";

export function EntityIcon({ icon, color }: { icon: EntityIconName; color: string }) {
  return (
    <svg className="entity-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill={color} fillRule="evenodd" d={ENTITY_ICONS[icon]} />
    </svg>
  );
}
