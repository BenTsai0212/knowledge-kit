// 待審頁的接縫（ADR 0011 決定 1、6、8，#378 PR 4a）：直接收錄之後，審核者（manager）看到的接縫、提問與選項（seam-review.ts），
// 以及選了之後寫入的決定：合併、補上名稱後建立、關係的「沒問題」、「都不是，我來說明」的說明（review_decisions.note）
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase } from "../../src/db/database";
import { approve, autoApprove, readReview, reject, writePending } from "../../src/extraction/store";
import { readGraph } from "../../src/graph/read";
import { relationSeamPlan, seamPartition, seamPlan } from "../../src/ui/seam-review";
import { uploadDocument } from "../../src/upload/write";

const { languages, defaultLanguage } = clientConfig.client;
const { entityTypes } = clientConfig.knowledgeModel;

// 一般員工的文件（內容虛構）：pe-a、pe-b 直接收錄；pe-c 林志明（兩個候選）、pe-d 張雅亭（與張雅婷只差一個字）、
// pe-e 英文名稱空白、pe-f 模型標示沒把握；pr-b 一端是接縫、pr-c 模型標示用詞沒把握（兩端直接收錄）
async function setup() {
  const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  const doc = await uploadDocument(
    db,
    "staff",
    { title: "青翼試用紀錄（虛構）", language: "zh-TW", visibility: "internal", project: "bluewing", date: "2026-10-02", passages: ["測試人員甲、林志明與張雅亭參與青翼專案。"] },
    { languages },
  );
  const p = doc.passageIds[0];
  await writePending(db, "staff", doc.documentId, {
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
  await autoApprove(db, "staff", doc.documentId, { entityTypes, languages, defaultLanguage });
  const review = async () => (await readReview(db, "manager")).find((d) => d.id === doc.documentId)!;
  const graph = await readGraph(db, "manager");
  return { db, review, graph };
}

describe("待審頁的接縫（seam-review.ts）", { timeout: 60_000 }, () => {
  it("接縫依提問分類，關係跟著接縫的端點；沒有接縫以外的待審項目", async () => {
    const { db, review, graph } = await setup();
    const part = seamPartition(await review(), graph.entities, { entityTypes, languages });
    const lin = graph.entities.filter((e) => e.name === "林志明").map((e) => e.id);
    const yating = graph.entities.find((e) => e.name === "張雅婷")!;
    expect(lin).toHaveLength(2);
    expect(part.entities.map((x) => [x.entity.id, x.ask, x.options, x.relations.map((r) => r.id)])).toEqual([
      ["pe-c", { kind: "candidates", candidates: lin }, [...lin.map((target) => ({ kind: "merge", target })), { kind: "new" }], ["pr-b"]],
      ["pe-d", { kind: "near", other: "張雅婷", target: yating.id }, [{ kind: "merge", target: yating.id }, { kind: "new" }], []],
      ["pe-e", { kind: "missing", languages: ["en"] }, [{ kind: "keep" }, { kind: "reject" }], []],
      ["pe-f", { kind: "unsure", unsure: "same_name" }, [{ kind: "keep" }, { kind: "reject" }], []],
    ]);
    expect(part.relations.map((x) => [x.relation.id, x.unsure])).toEqual([["pr-c", "relation_wording"]]);
    expect([...part.rest.entities, ...part.rest.relations].filter((x) => x.status === "pending")).toEqual([]);
    await db.close();
  });

  it("選了合併：這一項與底下兩端都已核准的關係一起核准；名稱缺少語言時補上才能建立", async () => {
    const { db, review, graph } = await setup();
    let doc = await review();
    const part = seamPartition(doc, graph.entities, { entityTypes, languages });
    const [lin, , team] = part.entities;
    const target = lin.options[0];
    const plan = seamPlan(doc, lin, target, undefined, graph, languages)!;
    expect(plan).toEqual({ entities: [{ id: "pe-c", mergeInto: (target as { target: string }).target }], relations: ["pr-b"], existingRelations: [] });
    await approve(db, "manager", plan, { defaultLanguage });

    expect(seamPlan(doc, team, team.options[0], undefined, graph, languages)).toBeNull();
    const names = { "zh-TW": "測試小組", en: "Test Team" };
    const filled = seamPlan(doc, team, team.options[0], names, graph, languages)!;
    expect(filled.entities).toEqual([{ id: "pe-e", names }]);
    await approve(db, "manager", filled, { defaultLanguage });

    doc = await review();
    const status = (id: string) => [...doc.entities, ...doc.relations].find((x) => x.id === id)?.status;
    expect([status("pe-c"), status("pr-b"), status("pe-e")]).toEqual(["approved", "approved", "approved"]);
    expect((await readGraph(db, "manager")).entities.find((e) => e.id === "pe-e")?.names).toEqual(names);
    await db.close();
  });

  it("關係的「沒問題」：兩端都已核准時核准；「都不是，我來說明」退回並記下說明（空白不記）", async () => {
    const { db, review, graph } = await setup();
    const doc = await review();
    const pr = doc.relations.find((r) => r.id === "pr-c")!;
    const plan = relationSeamPlan(doc, pr, graph)!;
    expect([...plan.relations, ...plan.existingRelations]).toEqual(["pr-c"]);
    expect(relationSeamPlan(doc, doc.relations.find((r) => r.id === "pr-b")!, graph)).toBeNull();
    await approve(db, "manager", plan, { defaultLanguage });

    await reject(db, "manager", { entities: ["pe-f"], relations: [] }, "  外部顧問，不是員工  ");
    await reject(db, "manager", { entities: ["pe-d"], relations: [] }, "   ");
    const notes = await db.withIdentity("manager", async (tx) =>
      (await tx.query<{ item_id: string; decision: string; note: string | null }>(
        "SELECT item_id, decision, note FROM kk.review_decisions WHERE item_id IN ('pe-d', 'pe-f', 'pr-c') ORDER BY item_id",
      )).rows,
    );
    expect(notes).toEqual([
      { item_id: "pe-d", decision: "reject", note: null },
      { item_id: "pe-f", decision: "reject", note: "外部顧問，不是員工" },
      { item_id: "pr-c", decision: "approve", note: null },
    ]);
    await db.close();
  });
});
