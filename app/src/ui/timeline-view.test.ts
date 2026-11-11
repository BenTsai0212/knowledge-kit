import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../graph/timeline";
import css from "./app.css?raw";
import { entityTypeShape, mentionedEntityIds, timelineEmptyKind, timelineSections } from "./timeline-view";

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
});
