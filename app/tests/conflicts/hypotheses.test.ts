// 說法不同的假設與證據（ADR 0012 決定 3，migration 0014）：資料庫的 CHECK，以及新欄位跟著該組的可見範圍
// （兩段都看得到才讀得到；沒有 canReview 的身分只讀得到「並存」「取代」的組）。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { decideConflict, readConflicts, writeConflicts, type ConflictPair } from "../../src/conflicts/store";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase } from "../../src/db/database";
import { uploadDocument } from "../../src/upload/write";

// 公開段落與青翼內部段落（guest 看不到青翼）
const PUBLIC = "employee-handbook-zh-01";
const BLUEWING = "bluewing-kickoff-zh-01";
const HYPOTHESES = ["我覺得是後來改過", "我覺得是不同的情況"];

async function setup() {
  const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  const upload = await uploadDocument(
    db,
    "staff",
    { title: "青翼進度（虛構）", language: "zh-TW", visibility: "internal", project: "bluewing", date: "2026-10-20", passages: ["青翼專案延到第三季。"] },
    { languages: clientConfig.client.languages },
  );
  const pair = (extra: Partial<ConflictPair> = {}): ConflictPair => ({
    id: "pc-h1",
    newPassage: upload.passageIds[0],
    oldPassage: BLUEWING,
    summary: "時程：第二季 → 第三季",
    hypotheses: HYPOTHESES,
    evidence: { text: "延到第三季", supports: 1 },
    ...extra,
  });
  return { db, upload, pair, write: (pairs: ConflictPair[]) => writeConflicts(db, "staff", upload.documentId, pairs) };
}

describe("假設與證據的寫入", { timeout: 30_000 }, () => {
  it("不合格的假設與證據被資料庫拒絕，整筆不寫入", async () => {
    const { db, upload, pair, write } = await setup();
    const bad: Partial<ConflictPair>[] = [
      { hypotheses: ["我覺得是後來改過"] },
      { hypotheses: [...HYPOTHESES, "我覺得有一份寫錯了", "第四個"] },
      { hypotheses: ["我覺得是後來改過", ""] },
      { hypotheses: ["我覺得是後來改過", "長".repeat(31)] },
      { hypotheses: ["我覺得是後來改過", "我覺得是後來改過"] },
      { hypotheses: [...HYPOTHESES, "我覺得是後來改過"] },
      // 三個欄位要同時有值或同時為 NULL
      { evidence: null },
      { hypotheses: null },
      { evidence: { text: "", supports: 1 } },
      { evidence: { text: "長".repeat(201), supports: 1 } },
      { evidence: { text: "延到第三季", supports: 0 } },
      { evidence: { text: "延到第三季", supports: 3 } },
    ];
    for (const extra of bad) {
      await expect(write([pair(extra)]), JSON.stringify(extra)).rejects.toMatchObject({ reason: "denied" });
    }
    // 陣列中的 NULL 也被拒絕（同一句 SQL 沒有 NULL 時寫得進去）
    const raw = (id: string, second: string | null) =>
      db.withIdentity("staff", (tx) =>
        tx.query(
          `INSERT INTO kk.conflicts (id, document_id, new_passage_id, old_passage_id, summary, hypotheses, evidence, evidence_hypothesis)
           VALUES ($1, $2, $3, $4, 's', ARRAY['我覺得是後來改過', $5::text], '延到第三季', 1)`,
          [id, upload.documentId, upload.passageIds[0], id === "pc-raw" ? BLUEWING : PUBLIC, second],
        ),
      );
    await expect(raw("pc-null", null)).rejects.toThrow();
    await raw("pc-raw", "我覺得是不同的情況");
    expect((await readConflicts(db, "manager")).map((c) => c.id)).toEqual(["pc-raw"]);
    await db.close();
  });
});

describe("假設與證據的可見範圍", { timeout: 30_000 }, () => {
  it("跟著該組：主管讀得到；處理為並存後，看得到兩段的人讀得到，看不到其中一段的人讀不到該組", async () => {
    const { db, pair, write } = await setup();
    // 第二組不帶假設（舊組合或不合格）：讀到 null
    await write([pair(), pair({ id: "pc-h2", oldPassage: PUBLIC, hypotheses: undefined, evidence: undefined })]);

    const manager = await readConflicts(db, "manager");
    expect(manager.map((c) => [c.id, c.hypotheses, c.evidence])).toEqual([
      ["pc-h1", HYPOTHESES, { text: "延到第三季", supports: 1 }],
      ["pc-h2", null, null],
    ]);
    // 未處理時，沒有 canReview 的上傳者讀不到
    expect(await readConflicts(db, "staff")).toEqual([]);

    await decideConflict(db, "manager", "pc-h1", "coexist");
    expect((await readConflicts(db, "staff")).map((c) => [c.id, c.hypotheses])).toEqual([["pc-h1", HYPOTHESES]]);
    // guest 看不到青翼的段落：讀不到這一組，也就讀不到假設與證據
    expect(await readConflicts(db, "guest")).toEqual([]);
    const raw = await db.withIdentity("guest", async (tx) => (await tx.query("SELECT hypotheses, evidence FROM kk.conflicts")).rows);
    expect(raw).toEqual([]);
    await db.close();
  });
});
