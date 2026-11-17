// 萃取的執行（#44）：以假的 /api/ask 測試分批、寫入待審、失敗與重試、同一份文件中的去重。CI 不呼叫真實 API。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import type { ClientConfig } from "../../src/client/types";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase } from "../../src/db/database";
import { foundNames, planExtraction, runExtraction, type ExtractionState } from "../../src/extraction/run";
import { readMyUploads, readReview, writePending } from "../../src/extraction/store";
import { readGraph } from "../../src/graph/read";
import { answered, fakeTransport } from "../../src/qa/testing";
import type { AskBody, AskEvent } from "../../src/qa/types";
import { seamPartition } from "../../src/ui/seam-review";
import { uploadDocument } from "../../src/upload/write";

const OPTIONS = { languages: clientConfig.client.languages };
// 萃取本身的測試用逐筆核准（item）：參考情境是 seams（#378 PR 4c），seams 的直接收錄另有測試
const item: ClientConfig = { ...clientConfig, client: { ...clientConfig.client, review: { mode: "item" } } };
const withBatches = (n: number): ClientConfig => ({ ...item, client: { ...item.client, upload: { ...item.client.upload, extractMaxBatches: n } } });

// 一般員工上傳一份虛構文件；long 為 true 時每段很長，會分成多批
async function setup(passages: string[], config: ClientConfig = item) {
  const db = await openDatabase(config, { seed: (pg) => seedDataset(pg, config, dataset) });
  const upload = await uploadDocument(
    db,
    "staff",
    { title: "萃取測試（虛構）", language: "zh-TW", visibility: "internal", project: "bluewing", date: "2026-10-03", passages },
    OPTIONS,
  );
  const state = planExtraction(config, {
    documentId: upload.documentId,
    uploader: "staff",
    documentLanguage: "zh-TW",
    passages: upload.passageIds.map((id, i) => ({ id, content: passages[i] })),
  });
  return { db, upload, state };
}

// 每批的回覆：依段落數回傳固定的實體與關係（引用第 1 段）
const reply = (entities: object[], relations: object[] = []) => answered(JSON.stringify({ entities, relations }));
const PERSON = { key: "e1", type: "person", names: { "zh-TW": "測試人員甲", en: "Test Person A" }, sources: [1] };
const PROJECT = { key: "e2", type: "project", names: { "zh-TW": "青翼專案", en: "Project Bluewing" }, sources: [1] };
const WORKS_ON = { type: "works-on", from: "e1", to: "e2", sources: [1] };

describe("runExtraction", { timeout: 30_000 }, () => {
  it("短文件：一批、以上傳者的身分寫入待審；核准者看得到，上傳者只看得到自己上傳的這份（ADR 0009）", async () => {
    const { db, upload, state } = await setup(["測試人員甲參與青翼專案的使用者測試。"]);
    const transport = fakeTransport(() => reply([PERSON, PROJECT], [WORKS_ON]));
    const states: ExtractionState[] = [];
    const result = await runExtraction({ db, transport, config: item }, state, (s) => states.push(s));

    expect(transport.bodies).toHaveLength(1);
    expect(transport.bodies[0].system).toContain("knowledge graph");
    expect(transport.bodies[0].messages[0].content).toContain('<passage number="1">\n測試人員甲參與青翼專案的使用者測試。\n</passage>');
    expect(result.batches).toMatchObject([{ status: "done", entities: 2, relations: 1, dropped: 0 }]);
    expect(states.map((s) => s.batches[0].status)).toEqual(["running", "done"]);
    // 找到的字詞（#242）：文件語言的名稱，依類型分組；寫入成功後才記錄
    expect(result.batches[0].found).toEqual([
      { type: "person", names: ["測試人員甲"] },
      { type: "project", names: ["青翼專案"] },
    ]);
    expect(states[0].batches[0].found).toEqual([]);

    const [doc] = (await readReview(db, "manager")).filter((d) => d.id === upload.documentId);
    expect(doc.entities.map((e) => [e.type, e.names.en, e.sources.map((s) => s.id)])).toEqual(
      expect.arrayContaining([
        ["person", "Test Person A", [upload.passageIds[0]]],
        ["project", "Project Bluewing", [upload.passageIds[0]]],
      ]),
    );
    expect(doc.relations).toHaveLength(1);
    expect((await readReview(db, "staff")).map((d) => [d.id, d.entities.length, d.relations.length])).toEqual([[upload.documentId, 2, 1]]);
    expect(await readReview(db, "guest")).toEqual([]);
    await db.close();
  });

  it("長文件：依段落分批，超過批數上限的段落不萃取", async () => {
    const passages = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段虛構內容。`.padEnd(900, "測"));
    const { db, state } = await setup(passages, withBatches(2));
    expect(state.batches).toHaveLength(2);
    expect(state.skipped.length).toBeGreaterThan(0);
    const transport = fakeTransport(() => reply([]));
    const result = await runExtraction({ db, transport, config: withBatches(2) }, state);
    expect(transport.bodies).toHaveLength(2);
    expect(result.batches.map((b) => b.status)).toEqual(["done", "done"]);
    await db.close();
  });

  it("失敗的批次可以重試，已成功的批次不重送；回應被 max_tokens 截斷、格式錯誤都記為失敗", async () => {
    const passages = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段虛構內容。`.padEnd(900, "測"));
    const { db, state } = await setup(passages, withBatches(3));
    expect(state.batches).toHaveLength(3);
    const replies: AskEvent[][] = [
      reply([PERSON]),
      [{ type: "delta", text: '{"entities":[' }, { type: "done", stopReason: "max_tokens" }],
      answered("這不是 JSON"),
    ];
    let calls = 0;
    const transport = fakeTransport(() => replies[calls++]);
    const first = await runExtraction({ db, transport, config: withBatches(3) }, state);
    expect(first.batches.map((b) => [b.status, b.error])).toEqual([
      ["done", undefined],
      ["failed", "truncated"],
      ["failed", "format"],
    ]);

    const retried: AskBody[] = [];
    const retry = fakeTransport((body) => (retried.push(body), reply([])));
    const second = await runExtraction({ db, transport: retry, config: withBatches(3) }, first);
    expect(retried).toHaveLength(2);
    expect(second.batches.map((b) => b.status)).toEqual(["done", "done", "done"]);
    await db.close();
  });

  it("/api/ask 的錯誤記為失敗；邀請碼失效時停止，後面的批次留待重試，已寫入的不受影響", async () => {
    const passages = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段虛構內容。`.padEnd(900, "測"));
    const { db, upload, state } = await setup(passages, withBatches(3));
    const replies: AskEvent[][] = [reply([PERSON]), [{ type: "error", error: "invalid_access_code" }], reply([PROJECT])];
    let calls = 0;
    const transport = fakeTransport(() => replies[calls++]);
    const result = await runExtraction({ db, transport, config: withBatches(3) }, state);
    expect(calls).toBe(2);
    expect(result.batches.map((b) => [b.status, b.error])).toEqual([
      ["done", undefined],
      ["failed", "invalid_access_code"],
      ["waiting", undefined],
    ]);
    const [doc] = (await readReview(db, "manager")).filter((d) => d.id === upload.documentId);
    expect(doc.entities.map((e) => e.names.en)).toEqual(["Test Person A"]);

    const daily = fakeTransport(() => [{ type: "error", error: "daily_limit" }]);
    const again = await runExtraction({ db, transport: daily, config: withBatches(3) }, result);
    expect(again.batches.map((b) => b.error)).toEqual([undefined, "daily_limit", "daily_limit"]);
    await db.close();
  });

  it("同一份文件中去重：跨批次與同一批中，文件語言的名稱相符（全形半形不同）的實體合成一筆，出處取聯集；關係也一樣", async () => {
    const passages = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段虛構內容。`.padEnd(900, "測"));
    const { db, upload, state } = await setup(passages, withBatches(2));
    const sameName = { ...PERSON, key: "e3", names: { "zh-TW": "測試人員甲　", en: "Someone Else" }, sources: [2] };
    const transport = fakeTransport(() => reply([PERSON, PROJECT, sameName], [WORKS_ON, { ...WORKS_ON, from: "e3", sources: [2] }]));
    await runExtraction({ db, transport, config: withBatches(2) }, state);

    const [doc] = (await readReview(db, "manager")).filter((d) => d.id === upload.documentId);
    expect(doc.entities).toHaveLength(2);
    const person = doc.entities.find((e) => e.type === "person")!;
    const firstOf = (b: number) => state.batches[b].passageIds;
    expect(person.sources.map((s) => s.id).sort()).toEqual([firstOf(0)[0], firstOf(0)[1], firstOf(1)[0], firstOf(1)[1]].sort());
    expect(doc.relations).toHaveLength(1);
    expect(doc.relations[0].sources).toHaveLength(4);
    await db.close();
  });

  it("文件語言的名稱不同、其他語言的名稱相同的兩個人員，保留為兩筆；文件語言的名稱只差大小寫或全形半形時合成一筆（#46 審查）", async () => {
    const { db, upload, state } = await setup(["林志明、林芷敏與測試人員Ａ都參與青翼專案的虛構測試。"]);
    const person = (key: string, zh: string, en: string) => ({ key, type: "person", names: { "zh-TW": zh, en }, sources: [1] });
    const entities = [
      person("e1", "林志明", "Zhiming Lin"),
      person("e2", "林芷敏", "Zhiming Lin"),
      person("e3", "測試人員Ａ", "Tester A"),
      // 全形 Ａ 與小寫 a：依 person 的 aliasRules（normalizeWidth、ignoreCase）視為相同；英文名稱不同不影響
      person("e4", "測試人員a", "Someone Else"),
    ];
    await runExtraction({ db, transport: fakeTransport(() => reply(entities)), config: item }, state);
    const [doc] = (await readReview(db, "manager")).filter((d) => d.id === upload.documentId);
    expect(doc.entities.map((e) => e.names["zh-TW"]).sort()).toEqual(["林志明", "林芷敏", "測試人員Ａ"].sort());
    await db.close();
  });

  it("模型標示的 unsure 寫入待審；同一批或跨批次合成一筆時保留第一個原因，後面批次的 unsure 也補上（ADR 0011 決定 1，#404）", async () => {
    const passages = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段虛構內容。`.padEnd(900, "測"));
    const { db, upload, state } = await setup(passages, withBatches(2));
    const advisor = { key: "e3", type: "person", names: { "zh-TW": "測試顧問乙", en: "Test Advisor B" }, sources: [1] };
    let call = 0;
    const transport = fakeTransport(() =>
      ++call === 1
        ? // 第 1 批：測試人員甲出現兩次，第二次標示沒把握；關係用詞不明確
          reply([PERSON, PROJECT, { ...PERSON, key: "e4", unsure: "same_name" }], [{ ...WORKS_ON, unsure: "relation_wording" }])
        : // 第 2 批：青翼專案已寫入，這一批的 unsure 補上；測試人員甲與關係已有標示，保留第一個；新的測試顧問乙以不合法的值標示
          reply([{ ...PROJECT, unsure: "possible_typo" }, { ...PERSON, unsure: "possible_typo" }, { ...advisor, unsure: 0.3 }], [{ ...WORKS_ON, unsure: "other" }]),
    );
    await runExtraction({ db, transport, config: withBatches(2) }, state);

    const [doc] = (await readReview(db, "manager")).filter((d) => d.id === upload.documentId);
    expect(doc.entities.map((e) => [e.names["zh-TW"], e.unsure ?? null]).sort()).toEqual(
      [
        ["測試人員甲", "same_name"],
        ["青翼專案", "possible_typo"],
        ["測試顧問乙", "other"],
      ].sort(),
    );
    expect(doc.relations.map((r) => r.unsure ?? null)).toEqual(["relation_wording"]);
    await db.close();
  });

  it("跨批次合成一筆時，任一批標示 unsure 就是接縫、不直接收錄；保留第一個原因；待審區、我的上傳與接縫分組讀到同一個標示（#404）", async () => {
    const passages = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段虛構內容。`.padEnd(900, "測"));
    const config: ClientConfig = { ...withBatches(3), client: { ...withBatches(3).client, review: { mode: "seams" } } };
    const { db, upload, state } = await setup(passages, config);
    expect(state.batches).toHaveLength(3);
    const advisor = { key: "e3", type: "person", names: { "zh-TW": "測試顧問乙", en: "Test Advisor B" }, sources: [1] };
    // 第 1 批沒有標示；第 2 批標示測試顧問乙與關係；第 3 批標示不同的原因
    const marks = [{}, { e: "same_name", r: "relation_wording" }, { e: "possible_typo", r: "other" }] as { e?: string; r?: string }[];
    let call = 0;
    const transport = fakeTransport(() => {
      const m = marks[call++];
      return reply([PERSON, PROJECT, { ...advisor, unsure: m.e }], [{ ...WORKS_ON, unsure: m.r }]);
    });
    const result = await runExtraction({ db, transport, config }, state);

    // 測試人員甲與青翼專案直接收錄；測試顧問乙與關係是接縫
    expect(result.autoApproved).toEqual({ status: "done", entities: 2, relations: 0, seams: 2 });
    const [doc] = (await readReview(db, "manager")).filter((d) => d.id === upload.documentId);
    const advisorItem = doc.entities.find((e) => e.names["zh-TW"] === "測試顧問乙")!;
    expect(advisorItem).toMatchObject({ status: "pending", unsure: "same_name" });
    expect(doc.relations).toMatchObject([{ status: "pending", unsure: "relation_wording" }]);

    const [mine] = (await readMyUploads(db, "staff")).filter((d) => d.id === upload.documentId);
    expect(mine.entities.find((e) => e.id === advisorItem.id)!.unsure).toBe("same_name");
    expect(mine.relations[0].unsure).toBe("relation_wording");

    const { entityTypes } = config.knowledgeModel;
    const part = seamPartition(mine, (await readGraph(db, "staff")).entities, { entityTypes, languages: config.client.languages });
    expect(part.entities.map((x) => [x.entity.id, x.ask])).toEqual([[advisorItem.id, { kind: "unsure", unsure: "same_name" }]]);
    expect(part.relations.map((x) => x.unsure)).toEqual(["relation_wording"]);

    // 每個項目只有一列
    const rows = await db.withIdentity("manager", async (tx) => [
      ...(await tx.query<{ unsure: string }>("SELECT unsure FROM kk.pending_entity_unsure")).rows,
      ...(await tx.query<{ unsure: string }>("SELECT unsure FROM kk.pending_relation_unsure")).rows,
    ]);
    expect(rows.map((r) => r.unsure).sort()).toEqual(["relation_wording", "same_name"]);
    await db.close();
  });

  it("重試萃取時，後面批次的 unsure 不重複、不遺失；寫入失敗的批次整批不留下標示（#404）", async () => {
    const passages = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段虛構內容。`.padEnd(900, "測"));
    const { db, upload, state } = await setup(passages, withBatches(3));
    const replies: AskEvent[][] = [reply([PERSON]), answered("這不是 JSON"), reply([PERSON])];
    let calls = 0;
    const first = await runExtraction({ db, transport: fakeTransport(() => replies[calls++]), config: withBatches(3) }, state);
    expect(first.batches.map((b) => b.status)).toEqual(["done", "failed", "done"]);

    // 重試第 2 批：這次標示沒把握
    const second = await runExtraction({ db, transport: fakeTransport(() => reply([{ ...PERSON, unsure: "same_name" }])), config: withBatches(3) }, first);
    expect(second.batches.map((b) => b.status)).toEqual(["done", "done", "done"]);
    const unsureRows = () =>
      db.withIdentity("manager", async (tx) => (await tx.query<{ id: string; unsure: string }>("SELECT pending_entity_id AS id, unsure FROM kk.pending_entity_unsure")).rows);
    const [doc] = (await readReview(db, "manager")).filter((d) => d.id === upload.documentId);
    expect(doc.entities.map((e) => e.unsure)).toEqual(["same_name"]);
    const id = doc.entities[0].id;
    expect(await unsureRows()).toEqual([{ id, unsure: "same_name" }]);

    // 已完成時再執行不重送；同一個標示重複寫入（或換原因）不新增列、不改變第一個原因
    const third = fakeTransport(() => reply([]));
    await runExtraction({ db, transport: third, config: withBatches(3) }, second);
    expect(third.bodies).toHaveLength(0);
    for (const unsure of ["same_name", "possible_typo"] as const) {
      await writePending(db, "staff", upload.documentId, { entities: [], relations: [], addedSources: [{ entity: id, passages: [], unsure }] });
    }
    expect(await unsureRows()).toEqual([{ id, unsure: "same_name" }]);

    // 同一批中有一列被拒絕時，整批回復，標示也不寫入
    const other = await setup(["測試人員甲參與青翼專案的使用者測試。"]);
    await runExtraction({ db: other.db, transport: fakeTransport(() => reply([PERSON])), config: item }, other.state);
    const target = (await readReview(other.db, "staff"))[0].entities[0].id;
    // 關係在標示之後寫入：id 格式不符被拒絕時，已寫入的標示一併回復
    const bad = { id: "x-r1", type: "works-on", from: target, to: target, sources: [other.upload.passageIds[0]] };
    await expect(
      writePending(other.db, "staff", other.upload.documentId, { entities: [], relations: [bad], addedSources: [{ entity: target, passages: [], unsure: "other" }] }),
    ).rejects.toMatchObject({ reason: "denied" });
    expect((await readReview(other.db, "staff"))[0].entities.map((e) => e.unsure)).toEqual([undefined]);
    await other.db.close();
    await db.close();
  });

  it("review.mode 為 seams 時，模型標示沒把握的項目留在待審，其餘直接收錄", async () => {
    const seams: ClientConfig = { ...clientConfig, client: { ...clientConfig.client, review: { mode: "seams" } } };
    const { db, upload, state } = await setup(["測試人員甲參與青翼專案的使用者測試。"], seams);
    const advisor = { key: "e3", type: "person", names: { "zh-TW": "測試顧問乙", en: "Test Advisor B" }, sources: [1], unsure: "same_name" };
    const transport = fakeTransport(() => reply([PERSON, PROJECT, advisor], [WORKS_ON, { ...WORKS_ON, from: "e3" }]));
    const result = await runExtraction({ db, transport, config: seams }, state);

    expect(result.autoApproved).toEqual({ status: "done", entities: 2, relations: 1, seams: 2 });
    const [doc] = (await readReview(db, "manager")).filter((d) => d.id === upload.documentId);
    const statusOf = (zh: string) => doc.entities.find((e) => e.names["zh-TW"] === zh)!;
    expect([statusOf("測試人員甲").mode, statusOf("青翼專案").mode]).toEqual(["auto", "auto"]);
    expect(statusOf("測試顧問乙")).toMatchObject({ status: "pending", unsure: "same_name" });
    expect(doc.relations.map((r) => r.status).sort()).toEqual(["approved", "pending"]);
    await db.close();
  });
});

describe("foundNames", () => {
  it("取文件語言的名稱，依類型分組、依出現順序，同類型不重複，空名稱略過", () => {
    const e = (type: string, zh: string, en = "x") => ({ type, names: { "zh-TW": zh, en } });
    expect(foundNames([e("person", "甲"), e("project", "青翼"), e("person", " 乙 "), e("person", "甲"), e("person", "")], "zh-TW")).toEqual([
      { type: "person", names: ["甲", "乙"] },
      { type: "project", names: ["青翼"] },
    ]);
    expect(foundNames([e("person", "甲", "A")], "en")).toEqual([{ type: "person", names: ["A"] }]);
  });
});
