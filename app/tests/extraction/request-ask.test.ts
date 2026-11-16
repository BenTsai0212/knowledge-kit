// 請上傳者確認的畫面邏輯（ADR 0011 決定 6，#378 PR 5b，畫板 S-Review、S-Request）：審核者（manager）請上傳者（staff）確認一個接縫後，
// 項目保留、不計入待審數字；上傳者首頁的提問依上傳者看得到的實體重算（seam-review.ts 的 uploaderAsks()）；回答後回到審核者，
// 附上回答的文字（seam-text.ts 的 replyLabel()）；審核者決定後提問消失
import { describe, expect, it } from "vitest";
import { strings } from "../../src/client/i18n";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase } from "../../src/db/database";
import { readRequests, replyToRequest, requestUploader } from "../../src/extraction/requests";
import { autoApprove, readMyUploads, readReview, reject, writePending } from "../../src/extraction/store";
import { readGraph } from "../../src/graph/read";
import { waitingSummary } from "../../src/ui/home";
import { reviewTabCounts } from "../../src/ui/review-helpers";
import { heldItems, openRequests, requestSeam, seamPartition, uploaderAsks } from "../../src/ui/seam-review";
import { replyLabel, replyOf, seamOptionLabel } from "../../src/ui/seam-text";
import { uploadDocument } from "../../src/upload/write";

const { languages, defaultLanguage } = clientConfig.client;
const { entityTypes } = clientConfig.knowledgeModel;
const ctx = { entityTypes, languages };
const s = strings(defaultLanguage);

// 一般員工的文件（內容虛構）：pe-a 直接收錄；pe-d 張雅亭（與張雅婷只差一個字）、pe-e 英文名稱空白是接縫
async function setup() {
  const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  const doc = await uploadDocument(
    db,
    "staff",
    { title: "青翼試用紀錄（虛構）", language: "zh-TW", visibility: "internal", project: "bluewing", date: "2026-10-02", passages: ["測試人員甲與張雅亭參與測試小組。"] },
    { languages },
  );
  const p = doc.passageIds[0];
  await writePending(db, "staff", doc.documentId, {
    entities: [
      { id: "pe-a", type: "person", names: { "zh-TW": "測試人員甲", en: "Test Person A" }, sources: [p] },
      { id: "pe-d", type: "person", names: { "zh-TW": "張雅亭", en: "Yating Zhang" }, sources: [p] },
      { id: "pe-e", type: "team", names: { "zh-TW": "測試小組", en: " " }, sources: [p] },
    ],
    relations: [],
  });
  await autoApprove(db, "staff", doc.documentId, { entityTypes, languages, defaultLanguage });
  const review = async () => (await readReview(db, "manager")).find((d) => d.id === doc.documentId)!;
  return { db, documentId: doc.documentId, review };
}

describe("請上傳者確認（seam-review.ts、seam-text.ts）", { timeout: 60_000 }, () => {
  it("請求後項目保留、不計入待審數字；上傳者看到依自己看得到的實體重算的提問，回答後回到審核者", async () => {
    const { db, documentId, review } = await setup();
    const before = reviewTabCounts([await review()], [], []).pending;
    await requestUploader(db, "manager", "pe-d");

    const requests = await readRequests(db, "manager");
    expect([...heldItems(requests)]).toEqual(["pe-d"]);
    expect(reviewTabCounts([await review()], [], [], heldItems(requests)).pending).toBe(before - 1);
    expect(waitingSummary([await review()], [], [], heldItems(requests)).total).toBe(before - 1);

    // 上傳者的首頁：一個提問，接縫照上傳者看得到的實體（張雅婷看得到時是「只差一個字」）
    const staffGraph = await readGraph(db, "staff");
    const mine = await readMyUploads(db, "staff");
    const asks = uploaderAsks(await readRequests(db, "staff"), mine, staffGraph.entities, ctx);
    expect(asks.map((a) => [a.doc.id, a.ask.kind, a.request.reply])).toEqual([[documentId, "entity", null]]);
    const ask = asks[0].ask;
    if (ask.kind !== "entity") throw new Error("expected an entity seam");
    const staffPart = seamPartition(mine.find((d) => d.id === documentId)!, staffGraph.entities, ctx);
    expect(ask.seam).toEqual(staffPart.entities.find((x) => x.entity.id === "pe-d"));

    // 上傳者選第一個選項；審核者看到回答，項目重新計入待審
    const option = ask.seam.options[0];
    await replyToRequest(db, "staff", asks[0].request.id, replyOf(option));
    const after = await readRequests(db, "manager");
    expect(heldItems(after).size).toBe(0);
    const reply = openRequests(after).get("pe-d")!.reply!;
    expect(reply.repliedBy).toBe("staff");
    const managerGraph = await readGraph(db, "manager");
    const managerSeam = seamPartition(await review(), managerGraph.entities, ctx).entities.find((x) => x.entity.id === "pe-d")!;
    expect(replyLabel(s, reply.choice, reply.mergeInto, managerGraph, defaultLanguage, managerSeam)).toBe(
      seamOptionLabel(s, option, managerGraph, defaultLanguage, managerSeam),
    );
    expect(reviewTabCounts([await review()], [], [], heldItems(after)).pending).toBe(before);

    // 回答後、決定前：上傳者的首頁仍列出（已送出）；審核者決定後消失
    expect(uploaderAsks(await readRequests(db, "staff"), await readMyUploads(db, "staff"), staffGraph.entities, ctx)[0].request.reply).not.toBeNull();
    await reject(db, "manager", { entities: ["pe-d"], relations: [] });
    expect(openRequests(await readRequests(db, "manager")).size).toBe(0);
    expect(uploaderAsks(await readRequests(db, "staff"), await readMyUploads(db, "staff"), staffGraph.entities, ctx)).toEqual([]);
    await db.close();
  });

  it("在上傳者看來不是接縫時問「該不該收錄」；項目不在待審時沒有提問；審核者看不到別人的提問", async () => {
    const { db, documentId, review } = await setup();
    const doc = await review();
    // 看不到任何實體時，張雅亭不是接縫：退回成「沒問題／不該收錄」
    expect(requestSeam(doc, "pe-d", [], ctx)).toEqual({
      kind: "entity",
      seam: { entity: doc.entities.find((e) => e.id === "pe-d"), ask: { kind: "unsure", unsure: "other" }, options: [{ kind: "keep" }, { kind: "reject" }], keepInto: null, relations: [] },
    });
    expect(requestSeam(doc, "pe-a", [], ctx)).toBeNull();
    await requestUploader(db, "manager", "pe-e");
    const managerDocs = (await readReview(db, "manager")).filter((d) => d.id === documentId);
    expect(uploaderAsks(await readRequests(db, "manager"), managerDocs, [], ctx)).toEqual([]);
    await db.close();
  });

  it("回答的文字：說明是「都不是，我來說明」；名稱缺少語言時「照系統的判斷收錄」是「我覺得沒問題」（上傳者不能補名稱）", async () => {
    const { db, review } = await setup();
    const graph = await readGraph(db, "manager");
    const team = seamPartition(await review(), graph.entities, ctx).entities.find((x) => x.entity.id === "pe-e")!;
    expect(team.ask.kind).toBe("missing");
    expect(seamOptionLabel(s, { kind: "keep" }, graph, defaultLanguage, team)).toBe(s.seamOptionFilled);
    expect(replyLabel(s, "keep", null, graph, defaultLanguage, team)).toBe(s.seamOptionKeep);
    expect(replyLabel(s, "other", null, graph, defaultLanguage, team)).toBe(s.commonExplain);
    expect(replyOf({ kind: "merge", target: "x" })).toEqual({ choice: "merge", mergeInto: "x" });
    await db.close();
  });
});
