// 只審接縫的直接收錄（ADR 0011 決定 1–5，#378 PR 2b）：store.ts 的 autoApprove() 與 runExtraction() 的開關。
// 上傳者（沒有 canReview 的一般員工）在一個交易中重算接縫，非接縫的項目寫 auto 決定並進入圖譜；接縫留在待審。
// 資料庫的 auto policy 另由 auto-review.test.ts 以 oracle 比對
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import type { ClientConfig } from "../../src/client/types";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { planExtraction, runExtraction } from "../../src/extraction/run";
import { autoApprove, readReview, reject, retract, ReviewError, writePending } from "../../src/extraction/store";
import { readGraph } from "../../src/graph/read";
import { answered, fakeTransport } from "../../src/qa/testing";
import { uploadDocument } from "../../src/upload/write";

const OPTIONS = { languages: clientConfig.client.languages };
const AUTO = { entityTypes: clientConfig.knowledgeModel.entityTypes, languages: clientConfig.client.languages, defaultLanguage: clientConfig.client.defaultLanguage };
const seams: ClientConfig = { ...clientConfig, client: { ...clientConfig.client, review: { mode: "seams" } } };
const item: ClientConfig = { ...clientConfig, client: { ...clientConfig.client, review: { mode: "item" } } };

async function upload(passages: string[]) {
  const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  const doc = await uploadDocument(
    db,
    "staff",
    { title: "青翼試用紀錄（虛構）", language: "zh-TW", visibility: "internal", project: "bluewing", date: "2026-10-02", passages },
    OPTIONS,
  );
  return { db, documentId: doc.documentId, passage: doc.passageIds[0] };
}

// 一般員工的文件（內容虛構）：
// pe-a 新的人（直接收錄）、pe-b 青翼專案（只有一個候選，直接合併）、pe-c 林志明（兩個候選）、pe-d 張雅亭（與張雅婷只差一個字）、
// pe-e 英文名稱空白、pe-f 模型標示沒把握；pr-a 兩端直接收錄、pr-b 一端是接縫、pr-c 模型標示沒把握
async function setup() {
  const w = await upload(["測試人員甲、林志明與張雅亭參與青翼專案的使用者測試。"]);
  const { db, documentId, passage: p } = w;
  await writePending(db, "staff", documentId, {
    entities: [
      { id: "pe-a", type: "person", names: { "zh-TW": "測試人員甲", en: "Test Person A" }, sources: [p] },
      { id: "pe-b", type: "project", names: { "zh-TW": "青翼專案", en: "Project Bluewing" }, sources: [p] },
      { id: "pe-c", type: "person", names: { "zh-TW": "林志明", en: "Zhiming Lin" }, sources: [p] },
      { id: "pe-d", type: "person", names: { "zh-TW": "張雅亭", en: "Yating Zhang" }, sources: [p] },
      { id: "pe-e", type: "team", names: { "zh-TW": "測試小組", en: " " }, sources: [p] },
      { id: "pe-f", type: "person", names: { "zh-TW": "測試顧問乙", en: "Test Advisor B" }, sources: [p], unsure: "same_name" },
    ],
    relations: [
      { id: "pr-a", type: "works-on", from: "pe-a", to: "pe-b", sources: [p] },
      { id: "pr-b", type: "leads", from: "pe-c", to: "pe-b", sources: [p] },
      { id: "pr-c", type: "member-of", from: "pe-a", to: "pe-b", sources: [p], unsure: "relation_wording" },
    ],
  });
  return w;
}

const reviewOf = async (db: Database, id: string, documentId: string) => {
  const doc = (await readReview(db, id)).find((d) => d.id === documentId)!;
  const items = [...doc.entities, ...doc.relations].map((x) => [x.id, x.status, x.mode ?? null, x.decisionId, "unsure" in x ? (x.unsure ?? null) : null] as const);
  return Object.fromEntries(items.map(([itemId, ...rest]) => [itemId, rest]));
};

describe("autoApprove（ADR 0011）", { timeout: 60_000 }, () => {
  it("非接縫的項目以上傳者的 auto 決定進入圖譜；接縫留在待審，並回傳原因", async () => {
    const { db, documentId, passage } = await setup();
    const result = await autoApprove(db, "staff", documentId, AUTO);
    expect(result).toEqual({
      entities: ["pe-a", "pe-b"],
      relations: ["pr-a"],
      seams: {
        "pe-c": ["candidates"],
        "pe-d": ["near_name"],
        "pe-e": ["missing_language"],
        "pe-f": ["unsure"],
        "pr-b": ["endpoint"],
        "pr-c": ["unsure"],
      },
    });

    // 上傳者的圖譜：新的人、合併到既有專案的出處、兩端解析後的關係
    const graph = await readGraph(db, "staff");
    expect(graph.entities.find((e) => e.id === "pe-a")).toMatchObject({ type: "person", name: "測試人員甲" });
    expect(graph.entities.find((e) => e.id === "project-bluewing")?.sources.map((s) => s.id)).toContain(passage);
    expect(graph.relations.find((r) => r.id === "pr-a")).toMatchObject({ from: "pe-a", to: "project-bluewing" });
    // 看不到這份文件的身分（訪客）看不到直接收錄的內容
    const guest = await readGraph(db, "guest");
    expect(guest.entities.some((e) => e.id === "pe-a")).toBe(false);

    // 審核者讀到的決定方式；接縫是待審
    const review = await reviewOf(db, "manager", documentId);
    expect(review["pe-a"]).toEqual(["approved", "auto", "pe-a", null]);
    expect(review["pr-a"]).toEqual(["approved", "auto", "pr-a", null]);
    expect(review["pe-c"]).toEqual(["pending", null, null, null]);
    expect(review["pe-f"]).toEqual(["pending", null, null, "same_name"]);
    expect(review["pr-c"]).toEqual(["pending", null, null, "relation_wording"]);
    await db.close();
  });

  it("再執行時不重複收錄；審核者撤回（記理由）後的項目不再直接收錄，連帶撤回的關係不記理由", async () => {
    const { db, documentId } = await setup();
    await autoApprove(db, "staff", documentId, AUTO);
    expect(await autoApprove(db, "staff", documentId, AUTO)).toMatchObject({ entities: [], relations: [] });

    // 上傳者沒有 canReview，不能撤回（0009）
    await expect(retract(db, "staff", ["pe-a"], "name")).rejects.toBeInstanceOf(ReviewError);
    await retract(db, "manager", ["pe-a"], "name");
    const reasons = await db.withIdentity("manager", async (tx) =>
      (await tx.query<{ decision_id: string; reason: string | null }>("SELECT decision_id, reason FROM kk.review_retractions ORDER BY decision_id")).rows,
    );
    expect(reasons).toEqual([
      { decision_id: "pe-a", reason: "name" },
      { decision_id: "pr-a", reason: null },
    ]);

    expect(await autoApprove(db, "staff", documentId, AUTO)).toMatchObject({ entities: [], relations: [] });
    const review = await reviewOf(db, "manager", documentId);
    expect(review["pe-a"][0]).toBe("pending");
    expect(review["pr-a"][0]).toBe("pending");
    expect((await readGraph(db, "staff")).entities.some((e) => e.id === "pe-a")).toBe(false);
    await db.close();
  });

  it("人已經退回的端點：關係留在待審（endpoint）", async () => {
    const { db, documentId } = await setup();
    // 審核者先退回 pe-b，依附的 pr-a、pr-b、pr-c 一併退回
    await reject(db, "manager", { entities: ["pe-b"], relations: [] });
    const result = await autoApprove(db, "staff", documentId, AUTO);
    expect(result.entities).toEqual(["pe-a"]);
    expect(result.relations).toEqual([]);
    await db.close();
  });

  it("同一份文件中兩個新實體只差一個字：兩個都留在待審，不寫入 auto 決定", async () => {
    const { db, documentId, passage: p } = await upload(["測試人員丙與測試人員丁參與青翼專案的使用者測試。"]);
    await writePending(db, "staff", documentId, {
      entities: [
        { id: "pe-x", type: "person", names: { "zh-TW": "測試人員丙", en: "Test Person C" }, sources: [p] },
        { id: "pe-y", type: "person", names: { "zh-TW": "測試人員丁", en: "Test Person D" }, sources: [p] },
      ],
      relations: [],
    });
    expect(await autoApprove(db, "staff", documentId, AUTO)).toEqual({
      entities: [],
      relations: [],
      seams: { "pe-x": ["near_name"], "pe-y": ["near_name"] },
    });
    const review = await reviewOf(db, "manager", documentId);
    expect(review["pe-x"]).toEqual(["pending", null, null, null]);
    expect(review["pe-y"]).toEqual(["pending", null, null, null]);
    const decisions = await db.withIdentity("manager", async (tx) =>
      (await tx.query("SELECT id FROM kk.review_decisions WHERE item_id IN ('pe-x', 'pe-y')")).rows,
    );
    expect(decisions).toEqual([]);
    await db.close();
  });

  it("別人的文件不能直接收錄：整筆不寫入", async () => {
    const { db, documentId } = await setup();
    await expect(autoApprove(db, "manager", documentId, AUTO)).rejects.toBeInstanceOf(ReviewError);
    expect((await reviewOf(db, "manager", documentId))["pe-a"][0]).toBe("pending");
    await db.close();
  });
});

const reply = (entities: object[], relations: object[] = []) => answered(JSON.stringify({ entities, relations }));
const PERSON = { key: "e1", type: "person", names: { "zh-TW": "測試人員甲", en: "Test Person A" }, sources: [1] };
const PROJECT = { key: "e2", type: "project", names: { "zh-TW": "青翼專案", en: "Project Bluewing" }, sources: [1] };
const WORKS_ON = { type: "works-on", from: "e1", to: "e2", sources: [1] };

describe("runExtraction 的 review.mode", { timeout: 60_000 }, () => {
  const run = async (config: ClientConfig, replies: (() => ReturnType<typeof reply>)[]) => {
    const passages = ["測試人員甲參與青翼專案的使用者測試。"];
    const { db, documentId, passage } = await upload(passages);
    const state = planExtraction(config, { documentId, uploader: "staff", documentLanguage: "zh-TW", passages: [{ id: passage, content: passages[0] }] });
    let n = 0;
    const transport = fakeTransport(() => replies[Math.min(n++, replies.length - 1)]());
    return { db, documentId, state, ctx: { db, transport, config } };
  };

  it("item：與現在相同，全部留在待審，不記錄直接收錄", async () => {
    const { db, documentId, state, ctx } = await run(item, [() => reply([PERSON, PROJECT], [WORKS_ON])]);
    const result = await runExtraction(ctx, state);
    expect(result.autoApproved).toBeUndefined();
    const doc = (await readReview(db, "manager")).find((d) => d.id === documentId)!;
    expect([...doc.entities, ...doc.relations].map((x) => x.status)).toEqual(["pending", "pending", "pending"]);
    await db.close();
  });

  it("seams：全部批次完成後直接收錄；批次失敗時不收錄，重試成功後才收錄", async () => {
    const failed = () => [{ type: "error" as const, error: "upstream_error" as const }];
    const { db, documentId, state, ctx } = await run(seams, [failed, () => reply([PERSON, PROJECT], [WORKS_ON])]);
    const first = await runExtraction(ctx, state);
    expect(first.batches[0].status).toBe("failed");
    expect(first.autoApproved).toBeUndefined();

    const changes: unknown[] = [];
    const second = await runExtraction(ctx, first, (s) => changes.push(s.autoApproved));
    expect(second.autoApproved).toEqual({ status: "done", entities: 2, relations: 1, seams: 0 });
    expect(changes.at(-1)).toEqual(second.autoApproved);
    const doc = (await readReview(db, "manager")).find((d) => d.id === documentId)!;
    expect([...doc.entities, ...doc.relations].map((x) => [x.status, x.mode])).toEqual([
      ["approved", "auto"],
      ["approved", "auto"],
      ["approved", "auto"],
    ]);
    await db.close();
  });
});
