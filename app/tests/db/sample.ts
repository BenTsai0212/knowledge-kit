// 滲漏矩陣用的最小虛構資料。以結構化資料表示，同一份資料同時匯入 PGlite 與交給 oracle.ts 計算預期結果。
import type { PGliteInterface } from "@electric-sql/pglite";

export interface Doc {
  id: string;
  level: string;
  project: string | null;
}
export interface Passage {
  id: string;
  doc: string;
  level: string;
  project: string | null;
}
export interface Entity {
  id: string;
  sources: string[];
}
export interface Relation {
  id: string;
  from: string;
  to: string;
  sources: string[];
}
export interface Sample {
  docs: Doc[];
  passages: Passage[];
  entities: Entity[];
  relations: Relation[];
}

const LEVELS = ["public", "internal", "confidential"];
const PROJECTS = [null, "aurora", "harbor"];

function build(): Sample {
  const docs: Doc[] = [];
  const passages: Passage[] = [];
  // 每種「可見等級 × 專案（含沒有專案）」各一份文件，各有一個相同條件的段落
  for (const level of LEVELS) {
    for (const project of PROJECTS) {
      const id = `doc-${level}-${project ?? "none"}`;
      docs.push({ id, level, project });
      passages.push({ id: `${id}-p0`, doc: id, level, project });
    }
  }
  // 比文件更機密的段落、比文件寬鬆的段落（仍受文件限制）、與文件不同專案的段落
  passages.push(
    { id: "doc-public-none-p1", doc: "doc-public-none", level: "confidential", project: null },
    { id: "doc-internal-aurora-p1", doc: "doc-internal-aurora", level: "confidential", project: "aurora" },
    { id: "doc-confidential-none-p1", doc: "doc-confidential-none", level: "public", project: null },
    { id: "doc-public-aurora-p1", doc: "doc-public-aurora", level: "public", project: "harbor" },
  );

  const entities: Entity[] = [
    { id: "e-public", sources: ["doc-public-none-p0"] },
    // 只出現在機密段落
    { id: "e-confidential-only", sources: ["doc-public-none-p1"] },
    // 同時出現在公開與機密段落：看得到公開段落的人就看得到
    { id: "e-mixed", sources: ["doc-public-none-p0", "doc-confidential-none-p0"] },
    { id: "e-aurora", sources: ["doc-internal-aurora-p0"] },
    { id: "e-harbor", sources: ["doc-internal-harbor-p0"] },
    // 出處段落寬鬆、但所屬文件機密
    { id: "e-loose-passage", sources: ["doc-confidential-none-p1"] },
    // 沒有出處：沒有人看得到
    { id: "e-orphan", sources: [] },
  ];
  const relations: Relation[] = [
    { id: "r-public", from: "e-public", to: "e-mixed", sources: ["doc-public-none-p0"] },
    // 出處公開，但一端的實體只有機密出處
    { id: "r-hidden-endpoint", from: "e-public", to: "e-confidential-only", sources: ["doc-public-none-p0"] },
    { id: "r-aurora", from: "e-aurora", to: "e-public", sources: ["doc-internal-aurora-p0"] },
    // 兩端都看得到，但出處只在另一個專案
    { id: "r-cross-project", from: "e-aurora", to: "e-public", sources: ["doc-internal-harbor-p0"] },
    { id: "r-orphan", from: "e-public", to: "e-mixed", sources: [] },
  ];
  return { docs, passages, entities, relations };
}

export const sample = build();

export async function seedSample(db: PGliteInterface): Promise<void> {
  await db.transaction(async (tx) => {
    for (const d of sample.docs) {
      await tx.query(
        "INSERT INTO kk.documents (id, title, language, visibility_level_id, project_id) VALUES ($1, $1, 'zh-TW', $2, $3)",
        [d.id, d.level, d.project],
      );
    }
    for (const [i, p] of sample.passages.entries()) {
      await tx.query(
        `INSERT INTO kk.passages (id, document_id, ordinal, language, content, visibility_level_id, project_id)
         VALUES ($1, $2, $3, 'zh-TW', $1, $4, $5)`,
        [p.id, p.doc, i, p.level, p.project],
      );
    }
    for (const e of sample.entities) {
      await tx.query("INSERT INTO kk.entities (id, entity_type, name) VALUES ($1, 'person', $1)", [e.id]);
      for (const s of e.sources) {
        await tx.query("INSERT INTO kk.entity_sources (entity_id, passage_id) VALUES ($1, $2)", [e.id, s]);
      }
    }
    for (const r of sample.relations) {
      await tx.query(
        "INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id) VALUES ($1, 'works-on', $2, $3)",
        [r.id, r.from, r.to],
      );
      for (const s of r.sources) {
        await tx.query(
          "INSERT INTO kk.relation_sources (relation_id, passage_id, from_entity_id, to_entity_id) VALUES ($1, $2, $3, $4)",
          [r.id, s, r.from, r.to],
        );
      }
    }
  });
}
