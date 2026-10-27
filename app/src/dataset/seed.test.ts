import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { openDatabase } from "../db/database";
import { dataset } from "./load";
import { DatasetImportError, seedDataset } from "./seed";

const open = (data = dataset) => openDatabase(clientConfig, { seed: (db) => seedDataset(db, clientConfig, data) });

describe("seedDataset", () => {
  it("以資料集初始化資料層：段落沿用文件的語言、等級與專案", async () => {
    const db = await open();
    const rows = await db.withIdentity("manager", async (tx) => ({
      documents: (await tx.query("SELECT id FROM kk.documents")).rows.length,
      passage: (
        await tx.query<{ ordinal: number; language: string; visibility_level_id: string; project_id: string | null; content: string }>(
          "SELECT ordinal, language, visibility_level_id, project_id, content FROM kk.passages WHERE id = 'employee-handbook-en-04'",
        )
      ).rows[0],
      relationSources: (await tx.query("SELECT * FROM kk.relation_sources")).rows.length,
    }));
    await db.close();
    expect(rows.documents).toBe(Object.keys(dataset.documents).length);
    expect(rows.passage).toMatchObject({ ordinal: 3, language: "en", visibility_level_id: "public", project_id: null });
    expect(rows.passage.content).toContain("Yizhen Wu");
    expect(rows.relationSources).toBe(dataset.relations.relations.reduce((n, r) => n + r.sources.length, 0));
  });

  it("檢查失敗時拋錯並列出位置，不建立資料庫", async () => {
    const data = structuredClone(dataset);
    data.entities.entities[0].type = "vendor";
    const opening = open(data);
    await expect(opening).rejects.toThrow(DatasetImportError);
    await expect(opening).rejects.toThrow("data/entities.json /entities/0/type：實體類型 vendor 不存在於 knowledge-model.json");
  });
});
