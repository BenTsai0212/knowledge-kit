// 上傳頁的輔助計算（#42）：誰看得到、預設的可見等級、今天的日期、檔案大小。
import type { AccessFile, Role } from "../client/types";
import { wordCount } from "../language/text";

// 依 access.json 算出看得到這個可見等級與專案的角色（與 docs/data-model.md 的讀取規則相同；
// 實際權限由 RLS 執行，這裡只是給上傳者參考，app/tests/upload/audience.test.ts 與 oracle 比對）
export function audienceRoles(access: AccessFile, level: string, project: string | null): Role[] {
  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
  return access.roles.filter(
    (role) => rank.get(level)! <= rank.get(role.visibility)! && (project === null || role.projects.includes(project)),
  );
}

// 上傳頁預設的可見等級（#192）：目前身分能選的等級中最嚴格的（rank 最高；同 rank 時取 access.json 中較前面的）。
// 忘了改時，看得到的人比預期少，不會變成公開給訪客；要放寬必須自己選。身分不存在時為空字串
export function defaultVisibility(access: AccessFile, roleId: string): string {
  const role = access.roles.find((r) => r.id === roleId);
  if (role === undefined) return "";
  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
  const max = rank.get(role.visibility)!;
  const choosable = access.visibilityLevels.filter((l) => l.rank <= max);
  return choosable.reduce<string>((best, l) => (best === "" || l.rank > rank.get(best)! ? l.id : best), "");
}

// 本地時區的今天，YYYY-MM-DD（不用 toISOString：那是 UTC，台灣早上 8 點前會差一天）
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 檔案卡片的字數（#242）：文字類別的規則在語言模組（language/text.ts 的 wordCount）
export function passagesWordCount(passages: readonly string[]): number {
  return passages.reduce((n, p) => n + wordCount(p), 0);
}

// 頁首的五個步驟（#242）：上傳 → 切段 → 模型萃取 → 人工審核 → 併入圖譜。
// 上傳頁不知道審核進度：萃取完成後「人工審核」為進行中並顯示送審筆數，「併入圖譜」保持未完成（#242 決定 3）
export type UploadStepName = "upload" | "chunk" | "extract" | "review" | "merge";
export type UploadStepStatus = "done" | "active" | "todo";
export type UploadStepDetail = { kind: "passages"; count: number } | { kind: "batch"; done: number; total: number } | { kind: "sent"; count: number };
export interface UploadStep {
  name: UploadStepName;
  status: UploadStepStatus;
  detail?: UploadStepDetail;
}

export interface UploadProgress {
  // 已選檔或已貼上文字
  hasInput: boolean;
  parsing: boolean;
  // 預覽成功後的段落數；還沒預覽時為 null
  passages: number | null;
  // 已寫入資料庫
  written: boolean;
  // 這份文件的萃取批次（還沒開始時為 null）
  batches: readonly { status: string; entities: number; relations: number }[] | null;
}

export function uploadSteps(p: UploadProgress): UploadStep[] {
  const batches = p.batches ?? [];
  const finished = batches.filter((b) => b.status === "done").length;
  const extracted = p.batches !== null && finished === batches.length;
  const running = batches.findIndex((b) => b.status === "running");
  const sent = batches.reduce((n, b) => n + b.entities + b.relations, 0);
  const read = p.passages !== null;
  return [
    { name: "upload", status: p.hasInput || read ? "done" : "active" },
    {
      name: "chunk",
      status: read ? "done" : p.hasInput || p.parsing ? "active" : "todo",
      ...(read && { detail: { kind: "passages", count: p.passages! } }),
    },
    {
      name: "extract",
      status: extracted ? "done" : p.written ? "active" : "todo",
      ...(p.batches !== null && batches.length > 0 && { detail: { kind: "batch", done: running >= 0 ? running + 1 : finished, total: batches.length } }),
    },
    { name: "review", status: extracted ? "active" : "todo", ...(extracted && { detail: { kind: "sent", count: sent } }) },
    { name: "merge", status: "todo" },
  ];
}

// 萃取中找到的字詞（#242）：已完成的批次中新增的實體名稱，依批次與批次內的順序。
// order 是批次內的第幾個（底線依序畫出的延遲），同一個名稱只取最早的批次
export interface FoundTerm {
  name: string;
  type: string;
  order: number;
}

export function foundTerms(batches: readonly { status: string; found: readonly { type: string; names: readonly string[] }[] }[]): FoundTerm[] {
  const seen = new Set<string>();
  const terms: FoundTerm[] = [];
  for (const batch of batches) {
    if (batch.status !== "done") continue;
    let order = 0;
    for (const group of batch.found)
      for (const name of group.names) {
        if (seen.has(name)) continue;
        seen.add(name);
        terms.push({ name, type: group.type, order: order++ });
      }
  }
  return terms;
}

// 原文中出現的字詞：每一處都標出，較長的名稱優先，標出的範圍不重疊。英文等不分大小寫（轉小寫後長度不變時）
export interface FoundRange extends FoundTerm {
  start: number;
  end: number;
}

export function underlineRanges(text: string, terms: readonly FoundTerm[]): FoundRange[] {
  const lower = text.toLowerCase();
  const folded = lower.length === text.length;
  const haystack = folded ? lower : text;
  const fold = (name: string) => (folded && name.toLowerCase().length === name.length ? name.toLowerCase() : name);
  const taken: FoundRange[] = [];
  const free = (start: number, end: number) => taken.every((r) => end <= r.start || start >= r.end);
  for (const term of [...terms].sort((a, b) => b.name.length - a.name.length)) {
    const needle = fold(term.name);
    if (needle === "") continue;
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length))
      if (free(at, at + needle.length)) taken.push({ ...term, start: at, end: at + needle.length });
  }
  return taken.sort((a, b) => a.start - b.start);
}
