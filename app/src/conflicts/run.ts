// 說法不同的比對（docs/conflicts.md「流程」）：萃取完成 → 以上傳者的身分挑選段落 → 呼叫一次 /api/ask → 解析並驗證 → 寫入待處理的組合。
// 挑選的段落在 planConflicts() 固定下來，重試時送出相同的內容；萃取已成功的批次不受影響。
import type { ClientConfig, LanguageCode } from "../client/types";
import type { Database } from "../db/database";
import { collect, type BatchStatus, type ExtractionState } from "../extraction/run";
import type { AskTransport } from "../qa/types";
import type { Retriever } from "../retrieval/retrieve";
import { ConflictFormatError, parseConflicts } from "./output";
import { conflictPromptParts, conflictSystemPrompt, type PromptDocument } from "./prompt";
import { selectConflictPassages, type ConflictSelection } from "./select";
import { newConflictId, writeConflicts } from "./store";

export interface ConflictState {
  documentId: string;
  // 上傳者的身分：一律以此身分檢索與寫入，之後切換身分不影響
  uploader: string;
  documentLanguage: LanguageCode;
  selection: ConflictSelection;
  // 沒有要送出的段落時直接是 done
  status: BatchStatus;
  // 與萃取相同：/api/ask 的錯誤類型，或 format、truncated、write
  error?: string;
  // 寫入的組數與捨棄的組數
  found: number;
  dropped: number;
  // 寫入的組合中新文件的段落 id（不重複，#242 決定 2）：上傳頁把這些段落標為說法不同。只在寫入成功後記錄
  passages: string[];
}

export interface ConflictContext {
  db: Database;
  transport: AskTransport;
  config: Pick<ClientConfig, "client">;
}

// 萃取結束後才比對：還有等待或執行中的批次，或因邀請碼失效而停止時不開始（重試萃取成功後再開始）
export function shouldDetectConflicts(config: Pick<ClientConfig, "client">, extraction: Pick<ExtractionState, "batches">): boolean {
  return (
    config.client.conflicts.enabled &&
    extraction.batches.every((b) => b.status === "done" || b.status === "failed") &&
    !extraction.batches.some((b) => b.error === "invalid_access_code")
  );
}

export async function planConflicts(
  ctx: { retriever: Retriever; config: Pick<ClientConfig, "client"> },
  upload: { documentId: string; uploader: string; documentLanguage: LanguageCode; document: PromptDocument; passages: { id: string; content: string }[] },
): Promise<ConflictState> {
  const system = conflictSystemPrompt(conflictPromptParts(ctx.config, upload.documentLanguage));
  const selection = await selectConflictPassages(
    ctx.retriever,
    { uploader: upload.uploader, documentId: upload.documentId, document: upload.document, language: upload.documentLanguage, passages: upload.passages, system },
    ctx.config.client.conflicts,
  );
  return {
    documentId: upload.documentId,
    uploader: upload.uploader,
    documentLanguage: upload.documentLanguage,
    selection,
    status: selection.user === null ? "done" : "waiting",
    found: 0,
    dropped: 0,
    passages: [],
  };
}

// 等待中或失敗時執行；每次狀態改變都呼叫 onChange（傳入新的物件）
export async function runConflicts(ctx: ConflictContext, initial: ConflictState, onChange: (state: ConflictState) => void = () => {}): Promise<ConflictState> {
  let state = initial;
  const update = (patch: Partial<ConflictState>) => {
    state = { ...state, ...patch };
    onChange(state);
    return state;
  };
  const { selection } = state;
  if (state.status === "done" || state.status === "running" || selection.user === null) return state;

  update({ status: "running", error: undefined });
  const system = conflictSystemPrompt(conflictPromptParts(ctx.config, state.documentLanguage));
  const result = await collect(ctx.transport.send({ model: ctx.config.client.model, system, messages: [{ role: "user", content: selection.user }] }));
  if ("error" in result) return update({ status: "failed", error: result.error });

  let parsed;
  try {
    parsed = parseConflicts(result.text, selection.newPassages, selection.existing, state.documentId);
  } catch (e) {
    if (!(e instanceof ConflictFormatError)) throw e;
    return update({ status: "failed", error: "format" });
  }

  const pairs = parsed.conflicts.map((c) => ({ id: newConflictId(), ...c }));
  try {
    await writeConflicts(ctx.db, state.uploader, state.documentId, pairs);
  } catch {
    return update({ status: "failed", error: "write" });
  }
  const dropped = Object.values(parsed.dropped).reduce((n, c) => n + (c ?? 0), 0);
  return update({ status: "done", found: pairs.length, dropped, passages: [...new Set(pairs.map((p) => p.newPassage))] });
}
