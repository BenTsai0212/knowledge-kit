// 我的上傳（#284，docs/design.md「日常工具」的「我的上傳」）：每份上傳的狀態與送出後的四步進度。
// 資料來自 store.ts 的 readMyUploads()（待審項目與目前有效的決定，ADR 0009）；本工作階段還在萃取的文件另由萃取的狀態判斷。
import type { ReviewDocument, ReviewStatus } from "../extraction/store";

// uploaded：還沒有萃取出項目（萃取中、失敗或沒有找到，#284 決定 4）；rejected：全部退回（#284 決定 3）
export type MyUploadStatus = "uploaded" | "in_review" | "approved" | "partly_rejected" | "rejected";

export interface ReviewCounts {
  // 這份文件還在萃取（本工作階段的背景萃取）
  extracting: boolean;
  total: number;
  pending: number;
  approved: number;
}

export function reviewCounts(doc: Pick<ReviewDocument, "entities" | "relations">, extracting: boolean): ReviewCounts {
  const items: { status: ReviewStatus }[] = [...doc.entities, ...doc.relations];
  return {
    extracting,
    total: items.length,
    pending: items.filter((x) => x.status === "pending").length,
    approved: items.filter((x) => x.status === "approved").length,
  };
}

// 撤回後的項目回到待審（status 為 pending），所以重新算是審核中
export function myUploadStatus(c: ReviewCounts): MyUploadStatus {
  if (c.total === 0) return "uploaded";
  if (c.extracting || c.pending > 0) return "in_review";
  if (c.approved === c.total) return "approved";
  return c.approved === 0 ? "rejected" : "partly_rejected";
}

// 四步進度：已上傳 → 萃取完成 → 等主管審核 → 出現在問答與圖譜。
// 萃取中時「萃取完成」為進行中；沒有萃取出項目時停在「已上傳」；全部退回時不會出現在問答與圖譜
export type ReviewStepName = "uploaded" | "extracted" | "review" | "published";
export type ReviewStepStatus = "done" | "active" | "todo";

export function reviewSteps(c: ReviewCounts): { name: ReviewStepName; status: ReviewStepStatus }[] {
  const status = myUploadStatus(c);
  const extracted = !c.extracting && c.total > 0;
  const decided = extracted && c.pending === 0;
  return [
    { name: "uploaded", status: "done" },
    { name: "extracted", status: extracted ? "done" : c.extracting ? "active" : "todo" },
    { name: "review", status: decided ? "done" : extracted ? "active" : "todo" },
    { name: "published", status: decided && (status === "approved" || status === "partly_rejected") ? "done" : "todo" },
  ];
}

// 送出後、還沒讀到待審項目時，以萃取的批次算出：完成的批次中送審的筆數都還在等審核
export function countsFromBatches(batches: readonly { status: string; entities: number; relations: number }[], running: boolean): ReviewCounts {
  const total = batches.filter((b) => b.status === "done").reduce((n, b) => n + b.entities + b.relations, 0);
  const extracting = running || batches.some((b) => b.status === "waiting" || b.status === "running");
  return { extracting, total, pending: total, approved: 0 };
}

// 重新上傳修正版：帶入原本的標題、語言、可見等級與專案，送出後是一份新的文件，重新送審（不連結兩版）
export interface Reupload {
  title: string;
  language: string;
  visibility: string;
  project: string | null;
}

export const reuploadOf = (doc: Pick<ReviewDocument, "title" | "language" | "visibility" | "project">): Reupload => ({
  title: doc.title,
  language: doc.language,
  visibility: doc.visibility,
  project: doc.project,
});

// 部分退回或全部退回時才提供「重新上傳修正版」
export const canReupload = (status: MyUploadStatus) => status === "partly_rejected" || status === "rejected";
