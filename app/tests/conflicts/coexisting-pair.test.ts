// 問答的說法不同提問讀的那一組（ADR 0012 決定 1、3，readCoexistingPair()）：只有處理為「並存」、兩段都看得到時讀得到，
// 兩段的順序不拘；看不到其中一段的身分讀不到，所以不會被問、也看不到假設與證據（#247）
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { decideConflict, readCoexistingPair, writeConflicts } from "../../src/conflicts/store";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase } from "../../src/db/database";
import { uploadDocument } from "../../src/upload/write";

// 公開段落與青翼內部段落（guest 看不到青翼）
const PUBLIC = "employee-handbook-zh-01";
const BLUEWING = "bluewing-kickoff-zh-01";
const HYPOTHESES = ["我覺得是後來改過", "我覺得是不同的情況"];

describe("readCoexistingPair", { timeout: 30_000 }, () => {
  it("只讀並存的組、兩段順序不拘；取代、未處理與看不到其中一段時是 null", async () => {
    const db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
    const upload = await uploadDocument(
      db,
      "staff",
      { title: "青翼進度（虛構）", language: "zh-TW", visibility: "internal", project: "bluewing", date: "2026-10-20", passages: ["青翼專案延到第三季。"] },
      { languages: clientConfig.client.languages },
    );
    const added = upload.passageIds[0];
    const base = { newPassage: added, summary: "時程：第二季 → 第三季", hypotheses: HYPOTHESES, evidence: { text: "延到第三季", supports: 1 } };
    await writeConflicts(db, "staff", upload.documentId, [
      { id: "pc-c1", oldPassage: BLUEWING, ...base },
      { id: "pc-c2", oldPassage: PUBLIC, ...base },
    ]);

    // 未處理：主管讀得到該組，但不是並存
    expect(await readCoexistingPair(db, "manager", [added, BLUEWING])).toBeNull();

    await decideConflict(db, "manager", "pc-c1", "coexist");
    await decideConflict(db, "manager", "pc-c2", "supersede");
    for (const passages of [
      [added, BLUEWING],
      [BLUEWING, added],
    ] as const) {
      const pair = await readCoexistingPair(db, "staff", passages);
      expect(pair).toMatchObject({ id: "pc-c1", decision: "coexist", hypotheses: HYPOTHESES, evidence: { text: "延到第三季", supports: 1 } });
      expect([pair?.newPassage.id, pair?.oldPassage.id]).toEqual([added, BLUEWING]);
    }
    // 取代不是提問的對象
    expect(await readCoexistingPair(db, "staff", [added, PUBLIC])).toBeNull();
    // guest 看不到青翼的段落
    expect(await readCoexistingPair(db, "guest", [added, BLUEWING])).toBeNull();
    // 沒有這一組
    expect(await readCoexistingPair(db, "staff", [BLUEWING, PUBLIC])).toBeNull();
    await db.close();
  });
});
