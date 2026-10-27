// 由 client/access.json 匯入可見等級、專案與身分。由 database.ts 在初始化時以 superuser 呼叫。
import type { PGliteInterface } from "@electric-sql/pglite";
import type { AccessFile } from "../client/types";

export async function seedAccess(db: PGliteInterface, access: AccessFile): Promise<void> {
  await db.transaction(async (tx) => {
    for (const level of access.visibilityLevels) {
      await tx.query("INSERT INTO kk.visibility_levels (id, rank) VALUES ($1, $2)", [level.id, level.rank]);
    }
    for (const project of access.projects) {
      await tx.query("INSERT INTO kk.projects (id) VALUES ($1)", [project.id]);
    }
    for (const role of access.roles) {
      await tx.query("INSERT INTO kk.identities (id, visibility_level_id) VALUES ($1, $2)", [role.id, role.visibility]);
      for (const project of role.projects) {
        await tx.query("INSERT INTO kk.identity_projects (identity_id, project_id) VALUES ($1, $2)", [role.id, project]);
      }
    }
  });
}
