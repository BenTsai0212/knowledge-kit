// 依檔名順序套用 migration，並記錄 checksum；已套用的 migration 被修改時拋錯（AGENTS.md 第 5 節）。
import type { PGliteInterface } from "@electric-sql/pglite";

export interface Migration {
  version: string;
  sql: string;
}

const files = import.meta.glob<string>("./migrations/*.sql", { query: "?raw", import: "default", eager: true });

export const migrations: Migration[] = Object.entries(files)
  .map(([path, sql]) => ({ version: path.replace(/^.*\//, "").replace(/\.sql$/, ""), sql }))
  .sort((a, b) => a.version.localeCompare(b.version));

async function checksum(sql: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// 由 database.ts 以 kk_owner 呼叫
export async function applyMigrations(db: PGliteInterface, list: Migration[] = migrations): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS kk_meta.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE kk_meta.schema_migrations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE kk_meta.schema_migrations FORCE ROW LEVEL SECURITY;
    DO $$ BEGIN
      CREATE POLICY owner_only ON kk_meta.schema_migrations TO kk_owner USING (true) WITH CHECK (true);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  const applied = new Map(
    (await db.query<{ version: string; checksum: string }>("SELECT version, checksum FROM kk_meta.schema_migrations")).rows.map(
      (r) => [r.version, r.checksum],
    ),
  );
  const done: string[] = [];
  for (const m of list) {
    const sum = await checksum(m.sql);
    const recorded = applied.get(m.version);
    if (recorded !== undefined) {
      if (recorded !== sum) throw new Error(`migration ${m.version} 已套用但內容被修改；請新增 migration，不要修改已套用的檔案`);
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query("INSERT INTO kk_meta.schema_migrations (version, checksum) VALUES ($1, $2)", [m.version, sum]);
    });
    done.push(m.version);
  }
  return done;
}
