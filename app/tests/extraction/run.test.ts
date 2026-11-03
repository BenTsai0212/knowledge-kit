// 萃取的執行（#44）：以假的 /api/ask 測試分批、寫入待審、失敗與重試、同一份文件中的去重。CI 不呼叫真實 API。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import type { ClientConfig } from "../../src/client/types";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase } from "../../src/db/database";
import { planExtraction, runExtraction, type ExtractionState } from "../../src/extraction/run";
import { readReview } from "../../src/extraction/store";
import { answered, fakeTransport } from "../../src/qa/testing";
import type { AskBody, AskEvent } from "../../src/qa/types";
import { uploadDocument } from "../../src/upload/write";

const OPTIONS = { languages: clientConfig.client.languages };
const withBatches = (n: number): ClientConfig => ({ ...clientConfig, client: { ...clientConfig.client, upload: { ...clientConfig.client.upload, extractMaxBatches: n } } });

// 一般員工上傳一份虛構文件；long 為 true 時每段很長，會分成多批
async function setup(passages: string[], config: ClientConfig = clientConfig) {
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
  it("短文件：一批、以上傳者的身分寫入待審；核准者看得到，上傳者看不到", async () => {
    const { db, upload, state } = await setup(["測試人員甲參與青翼專案的使用者測試。"]);
    const transport = fakeTransport(() => reply([PERSON, PROJECT], [WORKS_ON]));
    const states: ExtractionState[] = [];
    const result = await runExtraction({ db, transport, config: clientConfig }, state, (s) => states.push(s));

    expect(transport.bodies).toHaveLength(1);
    expect(transport.bodies[0].system).toContain("knowledge graph");
    expect(transport.bodies[0].messages[0].content).toContain('<passage number="1">\n測試人員甲參與青翼專案的使用者測試。\n</passage>');
    expect(result.batches).toMatchObject([{ status: "done", entities: 2, relations: 1, dropped: 0 }]);
    expect(states.map((s) => s.batches[0].status)).toEqual(["running", "done"]);

    const [doc] = (await readReview(db, "manager")).filter((d) => d.id === upload.documentId);
    expect(doc.entities.map((e) => [e.type, e.names.en, e.sources.map((s) => s.id)])).toEqual(
      expect.arrayContaining([
        ["person", "Test Person A", [upload.passageIds[0]]],
        ["project", "Project Bluewing", [upload.passageIds[0]]],
      ]),
    );
    expect(doc.relations).toHaveLength(1);
    expect(await readReview(db, "staff")).toEqual([]);
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
    await runExtraction({ db, transport: fakeTransport(() => reply(entities)), config: clientConfig }, state);
    const [doc] = (await readReview(db, "manager")).filter((d) => d.id === upload.documentId);
    expect(doc.entities.map((e) => e.names["zh-TW"]).sort()).toEqual(["林志明", "林芷敏", "測試人員Ａ"].sort());
    await db.close();
  });
});
