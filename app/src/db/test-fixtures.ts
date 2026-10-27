// 測試用的最小虛構資料：依 client/access.json 的等級與專案，各放一份文件、段落、實體與關係。
import type { PGliteInterface } from "@electric-sql/pglite";

export async function seedBasic(db: PGliteInterface): Promise<void> {
  await db.exec(`
    INSERT INTO kk.documents (id, title, language, visibility_level_id, project_id) VALUES
      ('doc-handbook', '員工手冊', 'zh-TW', 'public', NULL),
      ('doc-aurora-plan', '極光專案計畫', 'zh-TW', 'internal', 'aurora');
    INSERT INTO kk.passages (id, document_id, ordinal, language, content, visibility_level_id, project_id) VALUES
      ('p-handbook-0', 'doc-handbook', 0, 'zh-TW', '上班時間為九點到六點。', 'public', NULL),
      ('p-aurora-0', 'doc-aurora-plan', 0, 'zh-TW', '極光專案由王小明負責。', 'internal', 'aurora');
    INSERT INTO kk.entities (id, entity_type, name) VALUES
      ('e-wang', 'person', '王小明'),
      ('e-aurora', 'project', '極光專案');
    INSERT INTO kk.entity_sources (entity_id, passage_id) VALUES
      ('e-wang', 'p-aurora-0'),
      ('e-aurora', 'p-aurora-0');
    INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id) VALUES
      ('r-wang-aurora', 'works-on', 'e-wang', 'e-aurora');
    INSERT INTO kk.relation_sources (relation_id, passage_id) VALUES
      ('r-wang-aurora', 'p-aurora-0');
  `);
}

export const KK_TABLES = [
  "visibility_levels",
  "projects",
  "identities",
  "identity_projects",
  "documents",
  "passages",
  "entities",
  "entity_sources",
  "relations",
  "relation_sources",
] as const;
