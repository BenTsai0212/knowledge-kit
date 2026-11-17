// 待審頁的「已直接收錄」區（ADR 0011 決定 5，#378 PR 4b）：readReview() 的 autoRetracted、seam-review.ts 的 autoItems() 與 sample()。
// 直接收錄之後由審核者（manager）抽查、撤回並記理由；撤回的項目回到待審，「已直接收錄」區標示「已撤回」與理由
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase } from "../../src/db/database";
import { approve, autoApprove, readMyUploads, readReview, retract, writePending } from "../../src/extraction/store";
import { readGraph } from "../../src/graph/read";
import { autoItems, sample, seamPartition, seamPlan } from "../../src/ui/seam-review";
import { uploadDocument } from "../../src/upload/write";

const { languages, defaultLanguage } = clientConfig.client;
const { entityTypes } = clientConfig.knowledgeModel;

// 一般員工的文件（內容虛構）：pe-a、pe-b 直接收錄（pe-b 合併到既有的青翼專案）、pr-a 兩端直接收錄；pe-f 模型標示沒把握（接縫）
async function setup() {
  const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  const doc = await uploadDocument(
    db,
    "staff",
    { title: "青翼試用紀錄（虛構）", language: "zh-TW", visibility: "internal", project: "bluewing", date: "2026-10-02", passages: ["測試人員甲參與青翼專案。"] },
    { languages },
  );
  const p = doc.passageIds[0];
  await writePending(db, "staff", doc.documentId, {
    entities: [
      { id: "pe-a", type: "person", names: { "zh-TW": "測試人員甲", en: "Test Person A" }, sources: [p] },
      { id: "pe-b", type: "project", names: { "zh-TW": "青翼專案", en: "Project Bluewing" }, sources: [p] },
      { id: "pe-f", type: "person", names: { "zh-TW": "測試顧問乙", en: "Test Advisor B" }, sources: [p], unsure: "same_name" },
    ],
    relations: [{ id: "pr-a", type: "works-on", from: "pe-a", to: "pe-b", sources: [p] }],
  });
  await autoApprove(db, "staff", doc.documentId, { entityTypes, languages, defaultLanguage });
  const review = async (identity = "manager") => (await readReview(db, identity)).find((d) => d.id === doc.documentId)!;
  return { db, review, documentId: doc.documentId };
}

const ids = (items: { item: { id: string } }[]) => items.map((x) => x.item.id);

describe("已直接收錄（autoItems）", { timeout: 60_000 }, () => {
  it("直接收錄的實體與關係可以撤回；接縫不在其中，沒有撤回過的項目沒有 autoRetracted", async () => {
    const { db, review } = await setup();
    const doc = await review();
    const { active, retracted } = autoItems(doc);
    expect(ids(active)).toEqual(["pe-a", "pe-b", "pr-a"]);
    expect(active.map((x) => x.kind)).toEqual(["entity", "entity", "relation"]);
    expect(retracted).toEqual([]);
    expect(doc.entities.find((e) => e.id === "pe-b")?.mergedInto).toBe("project-bluewing");
    expect([...doc.entities, ...doc.relations].some((x) => "autoRetracted" in x)).toBe(false);
    await db.close();
  });

  it("撤回時記的理由標在項目上；連帶撤回的關係沒有理由；項目回到待審", async () => {
    const { db, review } = await setup();
    await retract(db, "manager", [(await review()).entities.find((e) => e.id === "pe-a")!.decisionId!], "name");
    const doc = await review();
    const { active, retracted } = autoItems(doc);
    expect(ids(active)).toEqual(["pe-b"]);
    expect(ids(retracted)).toEqual(["pe-a", "pr-a"]);
    expect(retracted.map((x) => [x.item.status, x.item.autoRetracted])).toEqual([
      ["pending", { reason: "name" }],
      ["pending", { reason: null }],
    ]);
    // 審核者重新核准後仍標示「已撤回」，但不是直接收錄（不能在這裡再撤回）
    await approve(db, "manager", { entities: [{ id: "pe-a" }], relations: ["pr-a"] }, { defaultLanguage });
    const again = autoItems(await review());
    expect(ids(again.active)).toEqual(["pe-b"]);
    expect(again.retracted.map((x) => [x.item.id, x.item.status, x.item.mode, x.item.autoRetracted])).toEqual([
      ["pe-a", "approved", "manual", { reason: "name" }],
      ["pr-a", "approved", "manual", { reason: null }],
    ]);
    await db.close();
  });

  it("撤回後回到待審的項目是接縫的卡片（#400）：有候選時列出候選與「是新的」，關係跟著端點；沒有留在逐筆核准", async () => {
    const { db, review } = await setup();
    const ctx = { entityTypes, languages };
    // pe-a（建立新實體）撤回時連帶撤回 pr-a；pe-b 合併到既有的青翼專案後撤回
    let doc = await review();
    await retract(db, "manager", [doc.entities.find((e) => e.id === "pe-a")!.decisionId!, doc.entities.find((e) => e.id === "pe-b")!.decisionId!], "merge");
    doc = await review();
    const graph = await readGraph(db, "manager");
    const part = seamPartition(doc, graph.entities, ctx);
    expect(part.entities.map((x) => [x.entity.id, x.ask, x.options, x.relations.map((r) => r.id)])).toEqual([
      ["pe-a", { kind: "unsure", unsure: "other" }, [{ kind: "keep" }, { kind: "reject" }], ["pr-a"]],
      ["pe-b", { kind: "unsure", unsure: "other" }, [{ kind: "merge", target: "project-bluewing" }, { kind: "new" }, { kind: "reject" }], []],
      ["pe-f", { kind: "unsure", unsure: "same_name" }, [{ kind: "keep" }, { kind: "reject" }], []],
    ]);
    expect([...part.rest.entities, ...part.rest.relations].filter((x) => x.status === "pending")).toEqual([]);
    // 「沒問題」建立新實體（另一端 pe-b 還在待審，關係先不核准）
    const plan = seamPlan(doc, part.entities[0], { kind: "keep" }, undefined, graph, languages)!;
    expect(plan).toEqual({ entities: [{ id: "pe-a" }], relations: [], existingRelations: [] });
    await db.close();
  });

  it("撤回後只剩關係在待審時，關係自己是接縫", async () => {
    const { db, review } = await setup();
    await retract(db, "manager", [(await review()).relations.find((r) => r.id === "pr-a")!.decisionId!], "relation");
    const part = seamPartition(await review(), (await readGraph(db, "manager")).entities, { entityTypes, languages });
    expect(part.relations.map((x) => [x.relation.id, x.unsure, x.options])).toEqual([["pr-a", "other", [{ kind: "keep" }, { kind: "reject" }]]]);
    expect(part.rest.relations.filter((r) => r.status === "pending")).toEqual([]);
    await db.close();
  });

  it("人做的決定被撤回時不算直接收錄的撤回", async () => {
    const { db, review } = await setup();
    await approve(db, "manager", { entities: [{ id: "pe-f" }], relations: [] }, { defaultLanguage });
    await retract(db, "manager", [(await review()).entities.find((e) => e.id === "pe-f")!.decisionId!], "other");
    const f = (await review()).entities.find((e) => e.id === "pe-f")!;
    expect(f.status).toBe("pending");
    expect(f.autoRetracted).toBeUndefined();
    expect(ids(autoItems(await review()).retracted)).toEqual([]);
    await db.close();
  });

  it("上傳者的「我的上傳」也讀得到撤回的標示（只讀，不能撤回）", async () => {
    const { db, review, documentId } = await setup();
    await retract(db, "manager", [(await review()).entities.find((e) => e.id === "pe-a")!.decisionId!], "exclude");
    const mine = (await readMyUploads(db, "staff")).find((d) => d.id === documentId)!;
    expect(mine.entities.find((e) => e.id === "pe-a")?.autoRetracted).toEqual({ reason: "exclude" });
    await db.close();
  });
});

describe("隨機抽查（sample）", () => {
  const items = ["a", "b", "c", "d", "e"];

  it("不重複地抽 n 項，保留原本的順序", () => {
    // 每次都取剩下的最後一個（Fisher–Yates 把抽過的位置換到後面）：e，接著是換過去的 a、b
    expect(sample(items, 3, () => 0.999)).toEqual(["a", "b", "e"]);
    // 每次都取剩下的第一個：a、b、c
    expect(sample(items, 3, () => 0)).toEqual(["a", "b", "c"]);
    for (let i = 0; i < 50; i++) {
      const picked = sample(items, 3);
      expect(new Set(picked).size).toBe(3);
      expect(picked).toEqual(items.filter((x) => picked.includes(x)));
    }
  });

  it("不足 n 項時全部；0 項時是空的", () => {
    expect(sample(["a", "b"], 3)).toEqual(["a", "b"]);
    expect(sample([], 3)).toEqual([]);
  });
});
