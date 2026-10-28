// 萃取的執行（docs/extraction.md「流程」）：上傳完成 → 分批 → 每批呼叫 /api/ask → 解析並驗證 → 同一份文件中去重 → 寫入待審。
// 一律以上傳者的身分寫入（#44 決定的補充 1）；狀態逐批記錄，重試時只送出失敗或還沒執行的批次，已成功的批次不重送。
import type { ClientConfig, LanguageCode } from "../client/types";
import type { Database } from "../db/database";
import type { AskEvent, AskTransport } from "../qa/types";
import { planBatches } from "./batch";
import { nameKeys } from "./merge";
import { ExtractionFormatError, parseExtraction } from "./output";
import { extractionSystemPrompt, extractionUserMessage, promptParts } from "./prompt";
import { newPendingEntityId, newPendingRelationId, writePending, type PendingInput } from "./store";

// /api/ask 的錯誤類型，或 format（輸出格式不符）、truncated（回應被 max_tokens 截斷）、write（寫入待審被拒絕）
export type BatchStatus = "waiting" | "running" | "done" | "failed";

export interface BatchState {
  passageIds: string[];
  status: BatchStatus;
  error?: string;
  // 這一批新增的待審實體與關係，以及捨棄的項目數
  entities: number;
  relations: number;
  dropped: number;
}

export interface ExtractionState {
  documentId: string;
  // 上傳者的身分：一律以此身分寫入待審，之後切換身分不影響
  uploader: string;
  // 文件的語言（上傳時設定的語言，不是介面語言）：同一份文件中的去重只比對這個語言的名稱；prompt 中的公司名稱也用這個語言
  documentLanguage: LanguageCode;
  passages: Record<string, string>;
  batches: BatchState[];
  // 超過批數上限、沒有萃取的段落
  skipped: string[];
  // 已寫入的待審實體與關係（正規化後的名稱或「類型＋兩端」→ 待審 id），供後面的批次去重
  entityKeys: Record<string, string>;
  relationKeys: Record<string, string>;
}

export interface ExtractionContext {
  db: Database;
  transport: AskTransport;
  config: Pick<ClientConfig, "client" | "knowledgeModel">;
}

export function planExtraction(
  config: ExtractionContext["config"],
  upload: { documentId: string; uploader: string; documentLanguage: LanguageCode; passages: { id: string; content: string }[] },
): ExtractionState {
  const system = extractionSystemPrompt(promptParts(config, upload.documentLanguage));
  const { batches, skipped } = planBatches(upload.passages, system, config.client.upload.extractMaxBatches);
  return {
    documentId: upload.documentId,
    uploader: upload.uploader,
    documentLanguage: upload.documentLanguage,
    passages: Object.fromEntries(upload.passages.map((p) => [p.id, p.content])),
    batches: batches.map((passageIds) => ({ passageIds, status: "waiting", entities: 0, relations: 0, dropped: 0 })),
    skipped,
    entityKeys: {},
    relationKeys: {},
  };
}

// 收齊一批的回應：成功時回傳文字，失敗時回傳錯誤類型
async function collect(events: AsyncIterable<AskEvent>): Promise<{ text: string } | { error: string }> {
  let text = "";
  for await (const event of events) {
    if (event.type === "delta") text += event.text;
    else if (event.type === "error") return { error: event.error };
    else return event.stopReason === "max_tokens" ? { error: "truncated" } : { text };
  }
  return { error: "upstream_interrupted" };
}

// 依序執行等待中與失敗的批次；每次狀態改變都呼叫 onChange（傳入新的物件）
export async function runExtraction(
  ctx: ExtractionContext,
  initial: ExtractionState,
  onChange: (state: ExtractionState) => void = () => {},
): Promise<ExtractionState> {
  let state = initial;
  const update = (index: number, batch: Partial<BatchState>, extra: Partial<ExtractionState> = {}) => {
    state = { ...state, ...extra, batches: state.batches.map((b, i) => (i === index ? { ...b, ...batch } : b)) };
    onChange(state);
  };
  const { config } = ctx;
  const system = extractionSystemPrompt(promptParts(config, state.documentLanguage));

  for (let i = 0; i < state.batches.length; i++) {
    if (state.batches[i].status === "done") continue;
    update(i, { status: "running", error: undefined });
    const numbering = state.batches[i].passageIds;
    const user = extractionUserMessage(numbering.map((id) => ({ content: state.passages[id] })));
    const result = await collect(ctx.transport.send({ model: config.client.model, system, messages: [{ role: "user", content: user }] }));
    if ("error" in result) {
      update(i, { status: "failed", error: result.error });
      // 邀請碼失效時停止，後面的批次留待重試
      if (result.error === "invalid_access_code") break;
      continue;
    }

    let parsed;
    try {
      parsed = parseExtraction(result.text, numbering, config.knowledgeModel, config.client.languages);
    } catch (e) {
      if (!(e instanceof ExtractionFormatError)) throw e;
      update(i, { status: "failed", error: "format" });
      continue;
    }

    // 同一份文件中去重：文件語言的名稱相符的實體、類型與兩端相同的關係，沿用前面寫入的待審項目，只補上出處
    const entityKeys = { ...state.entityKeys };
    const relationKeys = { ...state.relationKeys };
    const input: Required<PendingInput> = { entities: [], relations: [], addedSources: [] };
    const idOfKey = new Map<string, string>();
    for (const e of parsed.entities) {
      // 只比對文件語言的名稱：模型補上的其他語言名稱（例如人名的拼音）可能相同，不同的人不可在這裡被合成一筆（#46 審查）
      const keys = [...nameKeys(e.type, [e.names[state.documentLanguage]], config.knowledgeModel.entityTypes)];
      const existing = keys.map((k) => entityKeys[k]).find((id) => id !== undefined);
      const created = input.entities.find((x) => x.id === existing);
      if (existing === undefined) {
        const id = newPendingEntityId();
        input.entities.push({ id, type: e.type, names: e.names, sources: e.sources });
        idOfKey.set(e.key, id);
      } else if (created !== undefined) {
        // 同一批中名稱相符：合併到這一批新建的那筆
        created.sources = [...new Set([...created.sources, ...e.sources])];
        idOfKey.set(e.key, existing);
      } else {
        // 前面的批次已寫入：只補上出處
        input.addedSources.push({ entity: existing, passages: e.sources });
        idOfKey.set(e.key, existing);
      }
      for (const k of keys) entityKeys[k] ??= idOfKey.get(e.key)!;
    }
    for (const r of parsed.relations) {
      const from = idOfKey.get(r.from)!;
      const to = idOfKey.get(r.to)!;
      const key = `${r.type}|${from}|${to}`;
      const existing = relationKeys[key];
      const created = input.relations.find((x) => x.id === existing);
      if (existing === undefined) {
        const id = newPendingRelationId();
        input.relations.push({ id, type: r.type, from, to, sources: r.sources });
        relationKeys[key] = id;
      } else if (created !== undefined) {
        created.sources = [...new Set([...created.sources, ...r.sources])];
      } else {
        input.addedSources.push({ relation: existing, passages: r.sources });
      }
    }

    try {
      await writePending(ctx.db, state.uploader, state.documentId, input);
    } catch {
      update(i, { status: "failed", error: "write" });
      continue;
    }
    const dropped = Object.values(parsed.dropped).reduce((n, c) => n + (c ?? 0), 0);
    update(i, { status: "done", entities: input.entities.length, relations: input.relations.length, dropped }, { entityKeys, relationKeys });
  }
  return state;
}
