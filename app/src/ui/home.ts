// 首頁的純函式（#283，docs/design.md「日常工具」的「首頁」）：問候的時段、主管「等你處理」的數字、一般員工的「有更新」（#284）、
// 問過的問題、依身分的常見問題與可見範圍。
import type { AccessFile, ScenariosFile } from "../client/types";
import type { ConflictItem } from "../conflicts/store";
import type { ReviewDocument } from "../extraction/store";
import type { AnswerReport } from "../reports/store";
import { myUploadStatus, reviewCounts, type MyUploadStatus } from "./my-uploads";
import { pendingCount } from "./review-helpers";

export type GreetingPeriod = "morning" | "afternoon" | "evening";

// 依瀏覽器本地時間的時（0–23）：早安 5–11 時、午安 12–17 時、晚安 18–4 時
export function greetingPeriod(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

export interface WaitingSummary {
  // 有待審實體或關係的文件數
  documents: number;
  // 待處理的說法不同（組）
  conflicts: number;
  // 未處理的回答錯誤回報
  reports: number;
  // 未處理的回報中最早一則的時間（ISO 字串）；沒有時為 null
  earliestReport: string | null;
  // 導覽列「待審」的數字：與 pendingCount() 相同
  total: number;
}

// 主管的「等你處理」：只用目前身分讀得到的待審、說法不同與回報（讀取時已經過 RLS）
export function waitingSummary(
  docs: readonly ReviewDocument[],
  conflicts: readonly Pick<ConflictItem, "decision">[],
  reports: readonly Pick<AnswerReport, "resolution" | "reportedAt">[],
): WaitingSummary {
  const open = reports.filter((r) => r.resolution === null);
  const earliest = open.reduce<string | null>((min, r) => (min === null || Date.parse(r.reportedAt) < Date.parse(min) ? r.reportedAt : min), null);
  return {
    documents: docs.filter((d) => [...d.entities, ...d.relations].some((x) => x.status === "pending")).length,
    conflicts: conflicts.filter((c) => c.decision === null).length,
    reports: open.length,
    earliestReport: earliest,
    total: pendingCount(docs, conflicts, reports),
  };
}

// 一般員工的「有更新」最多列出的筆數（docs/design.md「首頁」的手機：只列三則）
export const MAX_UPDATES = 3;

export interface UploadUpdate {
  documentId: string;
  title: string;
  status: Exclude<MyUploadStatus, "uploaded">;
  // 「在圖譜中查看」要打開的實體（第一個核准的實體：合併對象或新建的實體）；沒有時為 null，動作是「查看進度」
  entityId: string | null;
}

// 一般員工的「有更新」（#284）：自己上傳的文件（readMyUploads() 的順序，新的在前）的審核中、已核准、部分退回、已退回。
// 還沒有萃取出項目的（已上傳）不列入（#284 決定 4）。只有已核准時的動作是在圖譜查看，其他是查看進度（看退回的項目或重新上傳）
export function uploadUpdates(docs: readonly ReviewDocument[], extracting: ReadonlySet<string>, max = MAX_UPDATES): UploadUpdate[] {
  const updates: UploadUpdate[] = [];
  for (const doc of docs) {
    const status = myUploadStatus(reviewCounts(doc, extracting.has(doc.id)));
    if (status === "uploaded") continue;
    // 核准為新實體時，正式資料的 id 是決定的 id（store.ts 的 newPendingEntityId 說明）
    const approved = doc.entities.find((e) => e.status === "approved");
    const entityId = status === "approved" && approved !== undefined ? (approved.mergedInto ?? approved.decisionId) : null;
    updates.push({ documentId: doc.id, title: doc.title, status, entityId });
  }
  return updates.slice(0, max);
}

// 問過的問題最多保留的筆數
export const MAX_ASKED = 20;

// 問過的問題：只存問題文字，最新的在前；同一個問題只留最新的一次
export function rememberQuestion(asked: readonly string[], question: string, max = MAX_ASKED): string[] {
  const text = question.trim();
  if (text === "") return [...asked];
  return [text, ...asked.filter((q) => q !== text)].slice(0, max);
}

// 「最近看過」最多保留的實體數
export const MAX_VIEWED = 5;

// 最近看過的實體：只存 id（名稱與能否看到在首頁以目前身分重新讀取），最新的在前，不重複
export const rememberViewed = (viewed: readonly string[], id: string, max = MAX_VIEWED): string[] => [id, ...viewed.filter((x) => x !== id)].slice(0, max);

// 首頁的常見問題：情境的角色是目前身分的那些情境
export const roleScenarios = (scenarios: ScenariosFile, role: string) => scenarios.scenarios.filter((x) => x.role === role);

// 身分的可見範圍：等級不高於身分的可見等級（由低到高），與身分所屬的專案
export function visibleScope(access: AccessFile, role: string): { levels: string[]; projects: string[] } {
  const r = access.roles.find((x) => x.id === role);
  const rank = access.visibilityLevels.find((l) => l.id === r?.visibility)?.rank;
  if (r === undefined || rank === undefined) return { levels: [], projects: [] };
  const levels = access.visibilityLevels.filter((l) => l.rank <= rank).sort((a, b) => a.rank - b.rank);
  return { levels: levels.map((l) => l.id), projects: [...r.projects] };
}
