// 匯入資料集：openDatabase(clientConfig, { seed: (db) => seedDataset(db, clientConfig, dataset) })。
// 先以 validate.ts 檢查，有錯誤時拋出並逐條列出位置，不寫入任何資料。
import type { PGliteInterface } from "@electric-sql/pglite";
import type { ClientConfig } from "../client/types";
import type { Dataset } from "./load";
import { formatErrors, validateDataset } from "./validate";

export class DatasetImportError extends Error {}

export async function seedDataset(db: PGliteInterface, config: ClientConfig, data: Dataset): Promise<void> {
  const errors = validateDataset(config, data);
  if (errors.length > 0) throw new DatasetImportError(`資料集檢查失敗：${errors.length} 個錯誤\n${formatErrors(errors)}`);

  await db.transaction(async (tx) => {
    for (const doc of Object.values(data.documents)) {
      await tx.query(
        "INSERT INTO kk.documents (id, title, language, visibility_level_id, project_id) VALUES ($1, $2, $3, $4, $5)",
        [doc.id, doc.title, doc.language, doc.visibility, doc.project ?? null],
      );
      for (const [ordinal, p] of doc.passages.entries()) {
        await tx.query(
          `INSERT INTO kk.passages (id, document_id, ordinal, language, content, visibility_level_id, project_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [p.id, doc.id, ordinal, p.language ?? doc.language, p.text, p.visibility ?? doc.visibility, p.project ?? doc.project ?? null],
        );
      }
    }
    for (const e of data.entities.entities) {
      await tx.query("INSERT INTO kk.entities (id, entity_type, name) VALUES ($1, $2, $3)", [e.id, e.type, e.name]);
      for (const s of e.sources) {
        await tx.query("INSERT INTO kk.entity_sources (entity_id, passage_id) VALUES ($1, $2)", [e.id, s]);
      }
    }
    for (const r of data.relations.relations) {
      await tx.query("INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id) VALUES ($1, $2, $3, $4)", [
        r.id,
        r.type,
        r.from,
        r.to,
      ]);
      for (const s of r.sources) {
        await tx.query(
          "INSERT INTO kk.relation_sources (relation_id, passage_id, from_entity_id, to_entity_id) VALUES ($1, $2, $3, $4)",
          [r.id, s, r.from, r.to],
        );
      }
    }
  });
}
