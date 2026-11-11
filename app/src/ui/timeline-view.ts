// 時間軸頁的純函式（#241，docs/design.md「全互動對照表」的「時間軸」）：依實體篩選時不移除文件，只標出是否符合，
// 位置不跳動；沒有日期的文件另成「未註明日期」區。輸入只有目前身分看得到的文件（readTimeline() 經 RLS），
// 這裡不計算、也不回傳任何與看不到的文件有關的資訊。
import type { TimelineEntry } from "../graph/timeline";
import { clientConfig } from "../client/load";
import { heroShape, type HeroShape } from "./entry-hero";

export interface TimelineRow {
  entry: TimelineEntry;
  // 沒有篩選時一律為 true；篩選時，文件有以該實體為出處的段落才為 true
  matches: boolean;
  // 文件提到的實體（各段落 entityIds 的聯集，依第一次出現的順序；只有看得到的實體）
  entityIds: string[];
}

export interface TimelineSections {
  dated: TimelineRow[];
  undated: TimelineRow[];
}

export function mentionedEntityIds(entry: TimelineEntry): string[] {
  return [...new Set(entry.passages.flatMap((p) => p.entityIds))];
}

// entries 已依日期由新到舊排序（沒有日期的在最後），各區保持原本的順序
export function timelineSections(entries: readonly TimelineEntry[], filter: string | null): TimelineSections {
  const sections: TimelineSections = { dated: [], undated: [] };
  for (const entry of entries) {
    const entityIds = mentionedEntityIds(entry);
    const row = { entry, matches: filter === null || entityIds.includes(filter), entityIds };
    (entry.date === null ? sections.undated : sections.dated).push(row);
  }
  return sections;
}

// 空狀態（#245）：沒有文件（"none"）、依實體篩選後沒有符合的文件（"filtered"，下一步是回到全部），或有文件可顯示（null）
export function timelineEmptyKind(sections: TimelineSections, filter: string | null): "none" | "filtered" | null {
  const rows = [...sections.dated, ...sections.undated];
  if (rows.length === 0) return "none";
  return filter !== null && !rows.some((r) => r.matches) ? "filtered" : null;
}

// 實體類型的形狀：人員圓形、部門圓角方形、專案小圓角方形（docs/design.md「實體顏色」），與入口頁主視覺相同的歸類
export function entityTypeShape(type: string): HeroShape {
  return heroShape(clientConfig.knowledgeModel.entityTypes.find((t) => t.id === type)?.icon);
}
