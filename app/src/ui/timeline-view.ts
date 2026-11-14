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

// 日期拆成年與月日（#282）：手機的日期欄只有 46px，年與月日分兩行；桌機照樣接成「YYYY-MM-DD」。
// 不是「YYYY-MM-DD」的字串不拆，整個放在 monthDay
export function dateParts(date: string): { year: string | null; monthDay: string } {
  const m = /^(\d{4})-(\d{2}-\d{2})$/.exec(date);
  return m === null ? { year: null, monthDay: date } : { year: m[1], monthDay: m[2] };
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

// 桌機（#346，畫板 F-Timeline）：有日期的文件依年份分組（年份是分組標題，日期欄只放 MM-DD）。rows 已由新到舊，各組保持原本的順序；
// 不是「YYYY-MM-DD」的日期歸在 year 為 null 的組（沒有標題）
export function yearGroups(rows: readonly TimelineRow[]): Array<{ year: string | null; rows: TimelineRow[] }> {
  const groups: Array<{ year: string | null; rows: TimelineRow[] }> = [];
  for (const row of rows) {
    const year = row.entry.date === null ? null : dateParts(row.entry.date).year;
    const last = groups.at(-1);
    if (last !== undefined && last.year === year) last.rows.push(row);
    else groups.push({ year, rows: [row] });
  }
  return groups;
}

// 桌機頁首的範圍（#346）：最早與最晚的文件月份，依介面語言以 Intl 格式化（例如「2026年1月」「January 2026」），
// 兩者相同時 to 為 null；連接兩者的文字在翻譯檔（timelineMonthRange）。Intl 的 formatRange 在 zh-TW 會變成「2026/1至2026/5」，所以不用。
// 只用傳入的文件（目前身分看得到的），沒有日期的文件不計入；沒有可用的日期時為 null
export function timelineMonths(entries: readonly TimelineEntry[], language: string): { from: string; to: string | null } | null {
  const dated = entries.flatMap((e) => (e.date === null ? [] : [e.date])).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const months = Array.from(new Set(dated.map((date) => date.slice(0, 7)))).sort();
  if (months.length === 0) return null;
  const format = (month: string) => new Intl.DateTimeFormat(language, { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  return { from: format(months[0]), to: months.length === 1 ? null : format(months.at(-1)!) };
}

// 卡片的語言短標（#346）：語言代碼的主要部分轉大寫（zh-TW → ZH、en → EN）
export const languageTag = (code: string): string => code.split("-")[0].toUpperCase();

// 卡片的說法不同小膠囊（#346）：各段落已處理為「並存」的另一份文件，依第一次出現的順序、同一份文件只列一次。
// 標示經 RLS 讀出，只有看得到另一段時才有（readPassageMarks()）
export function conflictDocuments(entry: TimelineEntry): Array<{ documentId: string; title: string }> {
  const seen = new Map<string, string>();
  for (const mark of entry.passages.flatMap((p) => p.marks)) {
    if (mark.kind === "conflict" && mark.documentId !== entry.documentId && !seen.has(mark.documentId)) seen.set(mark.documentId, mark.documentTitle);
  }
  return [...seen].map(([documentId, title]) => ({ documentId, title }));
}
