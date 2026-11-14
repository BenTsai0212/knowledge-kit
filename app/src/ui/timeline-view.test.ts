import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../graph/timeline";
import css from "./app.css?raw";
import { conflictDocuments, dateParts, entityTypeShape, languageTag, mentionedEntityIds, timelineEmptyKind, timelineMonths, timelineSections, yearGroups } from "./timeline-view";

const entry = (documentId: string, date: string | null, passages: string[][]): TimelineEntry => ({
  documentId,
  title: documentId,
  date,
  language: "zh-TW",
  visibility: "public",
  project: null,
  passages: passages.map((entityIds, i) => ({ id: `${documentId}-p${i}`, content: "", entityIds, marks: [] })),
});

const entries = [entry("new", "2026-03-01", [["a", "b"], ["b", "c"]]), entry("old", "2025-01-01", [[]]), entry("none", null, [["a"]])];

describe("時間軸的區段與篩選", () => {
  it("提到的實體是各段落的聯集，依第一次出現的順序", () => {
    expect(mentionedEntityIds(entries[0])).toEqual(["a", "b", "c"]);
  });

  it("沒有日期的文件另成一區，各區保持原本的順序", () => {
    const { dated, undated } = timelineSections(entries, null);
    expect(dated.map((r) => r.entry.documentId)).toEqual(["new", "old"]);
    expect(undated.map((r) => r.entry.documentId)).toEqual(["none"]);
    expect([...dated, ...undated].every((r) => r.matches)).toBe(true);
  });

  it("篩選時不移除文件，只標出不符合的（位置不跳動）", () => {
    const filtered = timelineSections(entries, "a");
    const all = timelineSections(entries, null);
    expect(filtered.dated.map((r) => r.entry.documentId)).toEqual(all.dated.map((r) => r.entry.documentId));
    expect(filtered.dated.map((r) => r.matches)).toEqual([true, false]);
    expect(filtered.undated.map((r) => r.matches)).toEqual([true]);
  });

  it("空狀態（#245）：沒有文件、篩選後沒有符合的文件（回到全部），有符合的文件時不是空狀態", () => {
    expect(timelineEmptyKind(timelineSections([], null), null)).toBe("none");
    expect(timelineEmptyKind(timelineSections([], "a"), "a")).toBe("none");
    expect(timelineEmptyKind(timelineSections(entries, "z"), "z")).toBe("filtered");
    expect(timelineEmptyKind(timelineSections(entries, "c"), "c")).toBeNull();
    expect(timelineEmptyKind(timelineSections(entries, null), null)).toBeNull();
  });

  it("實體類型的形狀：人員圓形、部門（team）圓角方形、專案小圓角方形", () => {
    expect(entityTypeShape("person")).toBe("circle");
    expect(entityTypeShape("team")).toBe("block");
    expect(entityTypeShape("project")).toBe("tile");
  });
});

describe("日期欄的年與月日（#282）", () => {
  it("「YYYY-MM-DD」拆成年與月日，其他字串不拆", () => {
    expect(dateParts("2026-03-01")).toEqual({ year: "2026", monthDay: "03-01" });
    expect(dateParts("2026")).toEqual({ year: null, monthDay: "2026" });
  });
});

describe("桌機的時間軸（#346，畫板 F-Timeline）", () => {
  const mark = (documentId: string, kind: "conflict" | "superseded_by" | "supersedes" = "conflict") => ({ kind, passageId: `${documentId}-p0`, documentId, documentTitle: `title-${documentId}` });

  it("有日期的文件依年份分組，各組保持由新到舊的順序", () => {
    const rows = timelineSections([entry("a", "2026-05-15", [[]]), entry("b", "2026-01-05", [[]]), entry("c", "2025-12-01", [[]])], null).dated;
    expect(yearGroups(rows).map((g) => [g.year, g.rows.map((r) => r.entry.documentId)])).toEqual([
      ["2026", ["a", "b"]],
      ["2025", ["c"]],
    ]);
  });

  it("頁首的範圍是最早到最晚的月份，只用傳入的文件，沒有日期的不計入", () => {
    expect(timelineMonths(entries, "en")).toEqual({ from: "January 2025", to: "March 2026" });
    expect(timelineMonths([entry("x", "2026-01-05", []), entry("y", "2026-01-20", [])], "en")).toEqual({ from: "January 2026", to: null });
    expect(timelineMonths([entry("none", null, [])], "en")).toBeNull();
    expect(timelineMonths([], "en")).toBeNull();
  });

  it("語言短標是語言代碼的主要部分轉大寫", () => {
    expect(languageTag("zh-TW")).toBe("ZH");
    expect(languageTag("en")).toBe("EN");
  });

  it("說法不同的小膠囊：只列並存的另一份文件，同一份文件只列一次", () => {
    const e = entry("doc", "2026-01-01", [[], []]);
    e.passages[0].marks = [mark("other"), mark("old", "supersedes")];
    e.passages[1].marks = [mark("other"), mark("third")];
    expect(conflictDocuments(e)).toEqual([
      { documentId: "other", title: "title-other" },
      { documentId: "third", title: "title-third" },
    ]);
  });
});

describe("時間軸的樣式（docs/design.md）", () => {
  const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  it("不符合篩選的文件降到 45% 不透明，以 base 刻度變淡", () => {
    expect(rule(".timeline-entry.dimmed .timeline-card")).toMatch(/opacity:\s*0\.45/);
    expect(rule(".timeline-card")).toMatch(/transition:\s*opacity var\(--motion-base\)/);
  });

  it("日期欄用等寬字、次要文字色、靠右", () => {
    const date = rule(".timeline-date");
    expect(date).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(date).toMatch(/color:\s*var\(--color-textMuted\)/);
    expect(date).toMatch(/text-align:\s*right/);
  });

  // 手機（#282，docs/design.md「時間軸、上傳、待審、評測台與更多（手機）」）
  const phone = (selector: string) => rule(`.app--phone ${selector}`);

  it("手機：日期欄 46px（只放 MM-DD，年份是分組標題，#358）", () => {
    expect(phone(".timeline-entry")).toMatch(/grid-template-columns:\s*46px /);
    expect(rule(".timeline-year h2,\n.timeline-page--desktop .timeline-undated h2")).toMatch(/font-size:\s*13px/);
  });

  it("手機（#358）：精簡卡片照畫板 G-Mobile-Pages，展開段落的按鈕至少 44px", () => {
    expect(rule(".timeline-page--phone .timeline-head h1")).toMatch(/font-size:\s*22px/);
    expect(rule(".timeline-page--phone .timeline-card")).toMatch(/padding:\s*12px 14px/);
    expect(rule(".timeline-page--phone .timeline-toggle")).toMatch(/min-height:\s*44px/);
  });

  it("桌機（#346）：72px 日期欄、24px 時間軸線，填滿內容區；未註明日期不畫日期欄與時間軸線", () => {
    expect(rule(".timeline-page--desktop .timeline-entry")).toMatch(/grid-template-columns:\s*72px 24px minmax\(0, 1fr\)/);
    expect(rule(".timeline-page.timeline-page--desktop")).toMatch(/max-width:\s*none/);
    expect(rule(".timeline-page--desktop .timeline-undated :is(.timeline-date, .timeline-rail)")).toMatch(/display:\s*none/);
  });

  it("桌機（#346）：時間軸的樣式都在 timeline-page--desktop 之下，手機與平板不受影響", () => {
    // 這些 class 只有桌機與手機（#358）的精簡卡片會輸出；與平板共用的 class 改樣式時一律加上 timeline-page--desktop
    const desktopOnly = /timeline-page--desktop|\.timeline-(card__head|lang|note|mentions-line|toggle|filter__label|head|year)\b/;
    const start = css.indexOf("桌機的時間軸（#346");
    expect(start).toBeGreaterThan(-1);
    // 從區塊說明之後的第一條規則到下一個區塊（.upload）；選擇器清單以「,換行」分隔（:is() 中的逗號不分）
    const block = css.slice(css.indexOf("*/", start) + 2, css.indexOf("\n.upload {", start)).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...block.matchAll(/(?:^|\})([^{}]+)\{/g)].flatMap((m) => m[1].split(/,\s*\n/).map((s) => s.trim()));
    expect(selectors.length).toBeGreaterThan(10);
    expect(selectors.filter((s) => !desktopOnly.test(s))).toEqual([]);
  });

  it("手機：篩選晶片一行、橫向滑動，晶片不換行、觸控目標至少 44px", () => {
    const filter = phone(".timeline-filter");
    expect(filter).toMatch(/flex-wrap:\s*nowrap/);
    expect(filter).toMatch(/overflow-x:\s*auto/);
    const chip = phone(".timeline-filter button.chip");
    expect(chip).toMatch(/flex:\s*none/);
    expect(chip).toMatch(/white-space:\s*nowrap/);
    expect(chip).toMatch(/min-height:\s*44px/);
  });
});
