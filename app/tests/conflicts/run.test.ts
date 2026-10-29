// 說法不同的比對（#51）：以假的 /api/ask 測試挑選（上傳者的身分）、寫入待處理的組合、失敗與重試。CI 不呼叫真實 API。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import type { ClientConfig } from "../../src/client/types";
import { planConflicts, runConflicts, shouldDetectConflicts, type ConflictState } from "../../src/conflicts/run";
import { readConflicts } from "../../src/conflicts/store";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase } from "../../src/db/database";
import type { BatchState } from "../../src/extraction/run";
import { answered, fakeTransport } from "../../src/qa/testing";
import type { AskEvent } from "../../src/qa/types";
import { openRetriever } from "../../src/retrieval/retrieve";
import { uploadDocument } from "../../src/upload/write";

const OPTIONS = { languages: clientConfig.client.languages };
// 第 1 段與青翼的進度（內部）不同；第 2 段與組織調整（機密）不同
const PASSAGES = ["因供應商延遲，青翼桌上市時間延後至 2026 年第四季。", "自 2026 年 7 月起，營運部下設倉儲組，由王小明擔任組長。"];
const BLUEWING = "bluewing-status-zh-01";
const CONFIDENTIAL = "reorg-2026-zh-01";

async function setup(uploader: string, visibility = "internal") {
  const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  const document = { title: "青翼與組織（虛構）", date: "2026-10-20" };
  const upload = await uploadDocument(db, uploader, { ...document, language: "zh-TW", visibility, project: "bluewing", passages: PASSAGES }, OPTIONS);
  const retriever = openRetriever(db, clientConfig.client.retrieval);
  const state = await planConflicts(
    { retriever, config: clientConfig },
    { documentId: upload.documentId, uploader, documentLanguage: "zh-TW", document, passages: upload.passageIds.map((id, i) => ({ id, content: PASSAGES[i] })) },
  );
  return { db, upload, state };
}

// 依送出的編號回覆：existing 以段落 id 指定，換成送出時的編號
const replyFor = (state: ConflictState, pairs: { new: number; existing: string; summary: string }[]): AskEvent[] =>
  answered(JSON.stringify({ conflicts: pairs.map((p) => ({ ...p, existing: state.selection.existing.findIndex((e) => e.id === p.existing) + 1 })) }));

describe("planConflicts", () => {
  it("以上傳者的身分挑選：一般員工送出的既有段落都是自己看得到的，不含機密段落", async () => {
    const staff = await setup("staff");
    const visible = await staff.db.withIdentity("staff", async (tx) => new Set((await tx.query<{ id: string }>("SELECT id FROM kk.passages")).rows.map((r) => r.id)));
    const ids = staff.state.selection.existing.map((p) => p.id);
    expect(ids).toContain(BLUEWING);
    expect(ids).not.toContain(CONFIDENTIAL);
    expect(ids.every((id) => visible.has(id))).toBe(true);
    expect(ids.some((id) => staff.upload.passageIds.includes(id))).toBe(false);
    expect(staff.state.status).toBe("waiting");
    await staff.db.close();
  });

  it("主管上傳時，送出的既有段落包含機密段落", async () => {
    const manager = await setup("manager", "confidential");
    expect(manager.state.selection.existing.map((p) => p.id)).toContain(CONFIDENTIAL);
    await manager.db.close();
  });
});

describe("runConflicts", () => {
  it("一次呼叫，寫入待處理的組合；核准者看得到，沒有 canReview 的上傳者看不到", async () => {
    const { db, upload, state } = await setup("staff");
    const transport = fakeTransport(() =>
      replyFor(state, [
        { new: 1, existing: BLUEWING, summary: "上市時間：第三季 → 第四季" },
        { new: 1, existing: BLUEWING, summary: "重複" },
      ]),
    );
    const states: ConflictState[] = [];
    const result = await runConflicts({ db, transport, config: clientConfig }, state, (s) => states.push(s));

    expect(transport.bodies).toHaveLength(1);
    expect(transport.bodies[0].system).toContain("find statements that disagree");
    expect(transport.bodies[0].messages[0].content).toBe(state.selection.user);
    expect(states.map((s) => s.status)).toEqual(["running", "done"]);
    expect(result).toMatchObject({ status: "done", found: 1, dropped: 1 });

    const items = await readConflicts(db, "manager");
    expect(items.map((c) => [c.newPassage.id, c.oldPassage.id, c.summary, c.decision])).toEqual([
      [upload.passageIds[0], BLUEWING, "上市時間：第三季 → 第四季", null],
    ]);
    expect(await readConflicts(db, "staff")).toEqual([]);

    // 已完成時不再呼叫
    await runConflicts({ db, transport, config: clientConfig }, result);
    expect(transport.bodies).toHaveLength(1);
    await db.close();
  });

  it("沒有要送出的段落時直接完成，不呼叫 /api/ask", async () => {
    const { db, state } = await setup("staff");
    const empty: ConflictState = { ...state, status: "done", selection: { ...state.selection, newPassages: [], existing: [], user: null } };
    const transport = fakeTransport();
    expect(await runConflicts({ db, transport, config: clientConfig }, empty)).toEqual(empty);
    expect(transport.bodies).toHaveLength(0);
    await db.close();
  });

  it("max_tokens 截斷、格式錯誤、邀請碼失效、/api/ask 的錯誤都記為失敗；重試送出相同的內容", async () => {
    const { db, state } = await setup("staff");
    const failures: [AskEvent[], string][] = [
      [[{ type: "delta", text: '{"conflicts":[' }, { type: "done", stopReason: "max_tokens" }], "truncated"],
      [answered("找到一組矛盾"), "format"],
      [[{ type: "error", error: "invalid_access_code" }], "invalid_access_code"],
      [[{ type: "error", error: "daily_limit" }], "daily_limit"],
    ];
    let current = state;
    for (const [events, error] of failures) {
      current = await runConflicts({ db, transport: fakeTransport(() => events), config: clientConfig }, current);
      expect(current, error).toMatchObject({ status: "failed", error });
    }
    const transport = fakeTransport(() => replyFor(state, [{ new: 1, existing: BLUEWING, summary: "上市時間：第三季 → 第四季" }]));
    current = await runConflicts({ db, transport, config: clientConfig }, current);
    expect(current).toMatchObject({ status: "done", found: 1, error: undefined });
    expect(transport.bodies[0].messages[0].content).toBe(state.selection.user);
    await db.close();
  });

  it("寫入被拒絕時記為失敗，整筆不寫入", async () => {
    const { db, state } = await setup("staff");
    // 以另一個身分寫入（不是上傳者）會被 RLS 拒絕
    const transport = fakeTransport(() => replyFor(state, [{ new: 1, existing: BLUEWING, summary: "上市時間：第三季 → 第四季" }]));
    const result = await runConflicts({ db, transport, config: clientConfig }, { ...state, uploader: "guest" });
    expect(result).toMatchObject({ status: "failed", error: "write" });
    expect(await readConflicts(db, "manager")).toEqual([]);
    await db.close();
  });
});

describe("shouldDetectConflicts", () => {
  const batch = (status: BatchState["status"], error?: string): BatchState => ({ passageIds: [], status, error, entities: 0, relations: 0, dropped: 0 });
  const disabled: ClientConfig = { ...clientConfig, client: { ...clientConfig.client, conflicts: { ...clientConfig.client.conflicts, enabled: false } } };

  it("萃取結束後才比對；因邀請碼失效而停止時不比對；設定關閉時不比對", () => {
    expect(shouldDetectConflicts(clientConfig, { batches: [batch("done"), batch("failed", "format")] })).toBe(true);
    expect(shouldDetectConflicts(clientConfig, { batches: [batch("done"), batch("running")] })).toBe(false);
    expect(shouldDetectConflicts(clientConfig, { batches: [batch("failed", "invalid_access_code"), batch("waiting")] })).toBe(false);
    expect(shouldDetectConflicts(clientConfig, { batches: [batch("done"), batch("failed", "invalid_access_code")] })).toBe(false);
    expect(shouldDetectConflicts(disabled, { batches: [batch("done")] })).toBe(false);
  });
});
