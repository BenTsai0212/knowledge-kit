import { describe, expect, it } from "vitest";
import { byDate, monthsBetween, seamReply, TEMPLATE_CHOICES, usesTemplate } from "./dialogue";
import type { ConflictItem, ConflictPassage } from "./store";

const passage = (id: string, date: string | null, content: string): ConflictPassage => ({
  id,
  documentId: `d-${id}`,
  documentTitle: `t-${id}`,
  visibility: "internal",
  project: null,
  date,
  language: "zh-TW",
  content,
});

const HYPOTHESES = ["我覺得是後來改過", "我覺得是不同的情況"];

const item = (extra: Partial<ConflictItem> = {}): ConflictItem => ({
  id: "pc-1",
  documentId: "d-new",
  summary: "時程不同",
  newPassage: passage("new", "2026-05-15", "青翼桌上市時間延後至 Q3。"),
  oldPassage: passage("old", "2026-02-10", "青翼桌預計 Q2 上市。"),
  hypotheses: HYPOTHESES,
  evidence: { text: "延後至 Q3", supports: 1 },
  decision: "coexist",
  ...extra,
});

describe("monthsBetween", () => {
  it("相差的整月數；日不到時少一個月", () => {
    expect(monthsBetween("2026-02-10", "2026-05-15")).toBe(3);
    expect(monthsBetween("2026-02-10", "2026-05-09")).toBe(2);
    expect(monthsBetween("2025-12-31", "2026-01-31")).toBe(1);
    expect(monthsBetween("2026-02-10", "2026-03-09")).toBe(0);
  });

  it("缺少日期、相同或較早時是 0", () => {
    expect(monthsBetween(null, "2026-05-15")).toBe(0);
    expect(monthsBetween("2026-05-15", null)).toBe(0);
    expect(monthsBetween("2026-05-15", "2026-05-15")).toBe(0);
    expect(monthsBetween("2026-05-15", "2026-02-10")).toBe(0);
  });
});

describe("byDate", () => {
  it("依文件日期分新舊；日期相同或缺少時新上傳的文件當作較新", () => {
    expect(byDate(item()).newer.id).toBe("new");
    const older = item({ newPassage: passage("new", "2026-01-01", "x"), oldPassage: passage("old", "2026-03-01", "y") });
    expect(byDate(older).newer.id).toBe("old");
    expect(byDate(item({ newPassage: passage("new", null, "x") })).newer.id).toBe("old");
    expect(byDate(item({ oldPassage: passage("old", null, "y") })).newer.id).toBe("new");
    expect(byDate(item({ newPassage: passage("new", null, "x"), oldPassage: passage("old", null, "y") })).newer.id).toBe("new");
    expect(byDate(item({ oldPassage: passage("old", "2026-05-15", "y") })).newer.id).toBe("new");
  });
});

describe("seamReply：有證據時", () => {
  it("選的就是證據支持的假設：補一句證據（附它所在的段落）", () => {
    expect(usesTemplate(item())).toBe(false);
    expect(seamReply(item(), 0)).toEqual({ kind: "evidence", passage: item().newPassage, quote: "延後至 Q3" });
  });

  it("與證據不合：提出證據支持的假設一次", () => {
    expect(seamReply(item(), 1)).toEqual({ kind: "challenge", to: 0, passage: item().newPassage, quote: "延後至 Q3" });
    // 證據在舊的那一段、支持第二個假設
    const old = item({ evidence: { text: "預計 Q2", supports: 2 } });
    expect(seamReply(old, 0)).toEqual({ kind: "challenge", to: 1, passage: old.oldPassage, quote: "預計 Q2" });
  });

  it("證據不在兩段中時只說明會記錄", () => {
    expect(seamReply(item({ evidence: { text: "不存在的句子", supports: 1 } }), 1)).toEqual({ kind: "record" });
  });
});

describe("seamReply：固定範本（假設或證據留空）", () => {
  const template = (extra: Partial<ConflictItem> = {}) => item({ hypotheses: null, evidence: null, ...extra });
  const wrong = TEMPLATE_CHOICES.indexOf("wrong");

  it("相差一個月以上而選「有一份寫錯了」才提出「後來改過」", () => {
    expect(usesTemplate(template())).toBe(true);
    expect(seamReply(template(), wrong)).toEqual({ kind: "challengeDate", to: TEMPLATE_CHOICES.indexOf("changed"), months: 3 });
  });

  it("其他選項、相差不到一個月、沒有日期時只說明會記錄", () => {
    expect(seamReply(template(), TEMPLATE_CHOICES.indexOf("changed"))).toEqual({ kind: "record" });
    expect(seamReply(template(), TEMPLATE_CHOICES.indexOf("different"))).toEqual({ kind: "record" });
    expect(seamReply(template({ oldPassage: passage("old", "2026-05-01", "y") }), wrong)).toEqual({ kind: "record" });
    expect(seamReply(template({ oldPassage: passage("old", null, "y") }), wrong)).toEqual({ kind: "record" });
  });

  it("只有假設、沒有證據時也用固定範本", () => {
    expect(usesTemplate(item({ evidence: null }))).toBe(true);
  });
});
