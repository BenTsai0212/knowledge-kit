import { describe, expect, it } from "vitest";
import { citedConflicts, type PassageMark } from "./marks";

const mark = (kind: PassageMark["kind"], passageId: string): PassageMark => ({ kind, passageId, documentId: `doc-${passageId}`, documentTitle: passageId });

describe("citedConflicts（#335）", () => {
  const numbering = ["p1", "p2", "p3", "p4"];
  const marks = new Map<string, PassageMark[]>([
    ["p2", [mark("conflict", "p3")]],
    ["p3", [mark("conflict", "p2")]],
    ["p1", [mark("conflict", "p9"), mark("supersedes", "p4")]],
    ["p4", [mark("superseded_by", "p1")]],
  ]);

  it("兩段都被引用的並存組合只列一次，標號小的在前", () => {
    expect(citedConflicts(numbering, ["p3", "p2", "p3"], marks)).toEqual([[2, 3]]);
  });

  it("只引用其中一段、取代關係、沒有編號的段落都不算", () => {
    expect(citedConflicts(numbering, ["p2"], marks)).toEqual([]);
    expect(citedConflicts(numbering, ["p1", "p4"], marks)).toEqual([]);
    expect(citedConflicts(["p1"], ["p1", "p9"], new Map([["p1", [mark("conflict", "p9")]]]))).toEqual([]);
  });

  it("多組時依標號排序", () => {
    const more = new Map(marks);
    more.set("p1", [mark("conflict", "p4")]);
    more.set("p4", [mark("conflict", "p1")]);
    expect(citedConflicts(numbering, ["p4", "p3", "p2", "p1"], more)).toEqual([
      [1, 4],
      [2, 3],
    ]);
  });
});
