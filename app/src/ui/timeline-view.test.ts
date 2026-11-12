import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../graph/timeline";
import css from "./app.css?raw";
import { dateParts, entityTypeShape, mentionedEntityIds, timelineEmptyKind, timelineSections } from "./timeline-view";

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

  it("手機：日期欄 46px，年與月日分兩行", () => {
    expect(phone(".timeline-entry")).toMatch(/grid-template-columns:\s*46px /);
    expect(phone(".timeline-date__year")).toMatch(/display:\s*block/);
    expect(phone(".timeline-date__sep")).toMatch(/display:\s*none/);
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
