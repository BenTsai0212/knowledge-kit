// 解析並驗證比對的輸出（docs/conflicts.md「驗證」）。格式錯誤時拋出 ConflictFormatError（整次失敗，可以重試）；
// 不符合規則的組合捨棄並依原因計數。
import { stripFence } from "../extraction/output";

// 與 migration 0008 的 CHECK 相同
export const MAX_SUMMARY_CHARS = 200;

export type ConflictDropReason =
  | "bad_number" // new 或 existing 不是送出的編號
  | "same_document" // 兩段屬於同一份文件
  | "duplicate" // 重複的組合
  | "bad_summary"; // summary 不是字串，或去掉前後空白後是空的、超過 200 字元

export interface ParsedConflict {
  newPassage: string;
  oldPassage: string;
  summary: string;
}

export interface ParsedConflicts {
  conflicts: ParsedConflict[];
  dropped: Partial<Record<ConflictDropReason, number>>;
}

export class ConflictFormatError extends Error {
  constructor() {
    super("模型輸出的格式不符");
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// newNumbering：送出的新段落 id；existing：送出的既有段落（id 與所屬文件）；documentId：新文件
export function parseConflicts(
  text: string,
  newNumbering: string[],
  existing: { id: string; documentId: string }[],
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
  const drop = (reason: ConflictDropReason) => (dropped[reason] = (dropped[reason] ?? 0) + 1);
  const pick = <T>(list: T[], n: unknown) => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= list.length ? list[(n as number) - 1] : undefined);

  const conflicts: ParsedConflict[] = [];
  for (const c of value.conflicts) {
    if (!isObject(c)) throw new ConflictFormatError();
    const newPassage = pick(newNumbering, c.new);
    const old = pick(existing, c.existing);
    if (newPassage === undefined || old === undefined) {
      drop("bad_number");
      continue;
    }
    if (old.documentId === documentId) {
      drop("same_document");
      continue;
    }
    if (conflicts.some((x) => x.newPassage === newPassage && x.oldPassage === old.id)) {
      drop("duplicate");
      continue;
    }
    const summary = typeof c.summary === "string" ? c.summary.trim() : "";
    if (summary === "" || summary.length > MAX_SUMMARY_CHARS) {
      drop("bad_summary");
      continue;
    }
    conflicts.push({ newPassage, oldPassage: old.id, summary });
  }
  return { conflicts, dropped };
}
