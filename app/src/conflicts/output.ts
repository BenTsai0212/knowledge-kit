// 解析並驗證比對的輸出（docs/conflicts.md「驗證」）。格式錯誤時拋出 ConflictFormatError（整次失敗，可以重試）；
// 不符合規則的組合捨棄並依原因計數。假設與證據不合格時只把這兩個欄位留空（該組退回固定範本），組合照常保留（#380 決定 2）。
import { stripFence } from "../extraction/output";

// 與 migration 0008、0014 的 CHECK 相同
export const MAX_SUMMARY_CHARS = 200;
export const MAX_HYPOTHESIS_CHARS = 30;
export const MAX_EVIDENCE_CHARS = 200;

export type ConflictDropReason =
  | "bad_number" // new 或 existing 不是送出的編號
  | "same_document" // 兩段屬於同一份文件
  | "duplicate" // 重複的組合
  | "bad_summary"; // summary 不是字串，或去掉前後空白後是空的、超過 200 字元

export type ConflictFallbackReason =
  | "bad_hypotheses" // 不是 2–3 個字串、有空的或超過 30 字、去掉前後空白後重複
  | "bad_evidence"; // 不是物件、text 沒有逐字出現在兩段之一或超過 200 字、supports 不是假設的位置

// 證據：原文中最能區分假設的一句話，與它支持的假設（1 起算）
export interface ConflictEvidence {
  text: string;
  supports: number;
}

export interface ParsedConflict {
  newPassage: string;
  oldPassage: string;
  summary: string;
  // 不合格時兩者都是 null
  hypotheses: string[] | null;
  evidence: ConflictEvidence | null;
}

export interface ParsedConflicts {
  conflicts: ParsedConflict[];
  dropped: Partial<Record<ConflictDropReason, number>>;
  // 保留、但假設與證據留空（退回固定範本）的組數
  fallback: Partial<Record<ConflictFallbackReason, number>>;
}

export class ConflictFormatError extends Error {
  constructor() {
    super("模型輸出的格式不符");
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// 與資料庫的 char_length 相同，以 code point 計算
const chars = (s: string) => [...s].length;

function parseHypotheses(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return null;
  const list = value.map((h) => (typeof h === "string" ? h.trim() : ""));
  if (list.some((h) => h === "" || chars(h) > MAX_HYPOTHESIS_CHARS)) return null;
  return new Set(list).size === list.length ? list : null;
}

function parseEvidence(value: unknown, hypotheses: string[], contents: string[]): ConflictEvidence | null {
  if (!isObject(value)) return null;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (text === "" || chars(text) > MAX_EVIDENCE_CHARS || !contents.some((c) => c.includes(text))) return null;
  const supports = value.supports;
  if (typeof supports !== "number" || !Number.isInteger(supports) || supports < 1 || supports > hypotheses.length) return null;
  return { text, supports };
}

// news：送出的新段落（第 i 個是編號 i + 1）；existing：送出的既有段落（id、所屬文件與內容）；documentId：新文件
export function parseConflicts(
  text: string,
  news: { id: string; content: string }[],
  existing: { id: string; documentId: string; content: string }[],
  documentId: string,
): ParsedConflicts {
  let value: unknown;
  try {
    value = JSON.parse(stripFence(text));
  } catch {
    throw new ConflictFormatError();
  }
  if (!isObject(value) || !Array.isArray(value.conflicts)) throw new ConflictFormatError();

  const dropped: ParsedConflicts["dropped"] = {};
  const fallback: ParsedConflicts["fallback"] = {};
  const drop = (reason: ConflictDropReason) => (dropped[reason] = (dropped[reason] ?? 0) + 1);
  const pick = <T>(list: T[], n: unknown) => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= list.length ? list[(n as number) - 1] : undefined);

  const conflicts: ParsedConflict[] = [];
  for (const c of value.conflicts) {
    if (!isObject(c)) throw new ConflictFormatError();
    const fresh = pick(news, c.new);
    const old = pick(existing, c.existing);
    if (fresh === undefined || old === undefined) {
      drop("bad_number");
      continue;
    }
    if (old.documentId === documentId) {
      drop("same_document");
      continue;
    }
    if (conflicts.some((x) => x.newPassage === fresh.id && x.oldPassage === old.id)) {
      drop("duplicate");
      continue;
    }
    const summary = typeof c.summary === "string" ? c.summary.trim() : "";
    if (summary === "" || summary.length > MAX_SUMMARY_CHARS) {
      drop("bad_summary");
      continue;
    }
    // 證據逐字出現在兩段之一（新段落或既有段落）；不合格時兩個欄位都留空
    const hypotheses = parseHypotheses(c.hypotheses);
    const evidence = hypotheses === null ? null : parseEvidence(c.evidence, hypotheses, [fresh.content, old.content]);
    if (evidence === null) {
      const reason: ConflictFallbackReason = hypotheses === null ? "bad_hypotheses" : "bad_evidence";
      fallback[reason] = (fallback[reason] ?? 0) + 1;
    }
    conflicts.push({ newPassage: fresh.id, oldPassage: old.id, summary, hypotheses: evidence === null ? null : hypotheses, evidence });
  }
  return { conflicts, dropped, fallback };
}
