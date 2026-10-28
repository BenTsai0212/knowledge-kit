import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { openDatabase, type Database } from "./database";
import { applyMigrations, migrations } from "./migrate";
import { KK_TABLES, seedBasic } from "./test-fixtures";

let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: seedBasic });
});
afterAll(async () => {
  await db.close();
});

const count = (identity: string | null, table: string) =>
  db.withIdentity(identity, async (tx) => (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM kk.${table}`)).rows[0].n);

describe("結構", () => {
  it("migration 依檔名順序載入", () => {
    expect(migrations.map((m) => m.version)).toEqual(["0001_schema", "0002_rls", "0003_relation_sources_endpoints", "0004_document_dates_entity_names", "0005_upload_write"]);
  });

  it("通用資料表與欄位存在", async () => {
    const columns = await db.withIdentity(null, async (tx) =>
      (
        await tx.query<{ table_name: string; column_name: string }>(
          "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'kk'",
        )
      ).rows.map((r) => `${r.table_name}.${r.column_name}`),
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "documents.language",
        "documents.visibility_level_id",
        "documents.project_id",
        "passages.language",
        "passages.visibility_level_id",
        "passages.project_id",
        "entity_sources.passage_id",
        "relation_sources.passage_id",
        "identities.visibility_level_id",
        "identity_projects.project_id",
        "documents.document_date",
        "entities.names",
        "identities.can_upload",
        "documents.uploaded_by",
      ]),
    );
  });

  it("所有資料表都屬於 kk_owner，並 ENABLE 與 FORCE ROW LEVEL SECURITY", async () => {
    const rows = await db.withIdentity(null, async (tx) =>
      (
        await tx.query<{ relname: string; owner: string; rls: boolean; force: boolean }>(`
          SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname IN ('kk', 'kk_meta') AND c.relkind = 'r'
          ORDER BY c.relname`)
      ).rows,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual([...KK_TABLES, "schema_migrations"].sort());
    for (const r of rows) expect(r, r.relname).toMatchObject({ owner: "kk_owner", rls: true, force: true });
  });

  it("kk_app 不是 superuser、不能 BYPASSRLS、不是 kk_owner 的成員", async () => {
    const row = await db.withIdentity(null, async (tx) =>
      (
        await tx.query<{ rolsuper: boolean; rolbypassrls: boolean; member: boolean; me: string }>(`
          SELECT rolsuper, rolbypassrls, pg_has_role('kk_app', 'kk_owner', 'MEMBER') AS member, current_user AS me
          FROM pg_roles WHERE rolname = 'kk_app'`)
      ).rows[0],
    );
    expect(row).toEqual({ rolsuper: false, rolbypassrls: false, member: false, me: "kk_app" });
  });
});

describe("身分", () => {
  it("沒有設定身分時，每張資料表都查不到資料", async () => {
    for (const table of KK_TABLES) expect(await count(null, table), table).toBe(0);
  });

  it("不存在的身分查不到資料", async () => {
    for (const table of KK_TABLES) expect(await count("nobody", table), table).toBe(0);
  });

  it("身分只在交易內有效，不跨交易殘留", async () => {
    const inside = await db.withIdentity("manager", async (tx) => ({
      setting: (await tx.query<{ v: string }>("SELECT current_setting('kk.identity_id', true) AS v")).rows[0].v,
      documents: (await tx.query("SELECT id FROM kk.documents")).rows.length,
    }));
    expect(inside).toEqual({ setting: "manager", documents: 2 });
    const after = await db.withIdentity(null, async (tx) => ({
      setting: (await tx.query<{ v: string | null }>("SELECT current_setting('kk.identity_id', true) AS v")).rows[0].v,
      documents: (await tx.query("SELECT id FROM kk.documents")).rows.length,
    }));
    expect(after.documents).toBe(0);
    expect(after.setting ?? "").toBe("");
  });

  it("只看得到自己的身分與專案名單", async () => {
    const rows = await db.withIdentity("staff", async (tx) => ({
      identities: (await tx.query<{ id: string }>("SELECT id FROM kk.identities")).rows.map((r) => r.id),
      managerProjects: (await tx.query("SELECT * FROM kk.identity_projects WHERE identity_id = 'manager'")).rows.length,
    }));
    expect(rows).toEqual({ identities: ["staff"], managerProjects: 0 });
  });

  it("有身分時看得到全部的可見等級與專案名單", async () => {
    expect(await count("guest", "visibility_levels")).toBe(3);
    expect(await count("guest", "projects")).toBe(2);
  });
});

describe("migrate", () => {
  it("已套用的 migration 被修改時拋錯；未修改時不重複套用", async () => {
    const pg = await PGlite.create();
    await pg.exec("CREATE ROLE kk_owner NOLOGIN; CREATE SCHEMA kk; CREATE SCHEMA kk_meta;");
    const v1 = [{ version: "0001_t", sql: "CREATE TABLE kk.t (a int);" }];
    expect(await applyMigrations(pg, v1)).toEqual(["0001_t"]);
    expect(await applyMigrations(pg, v1)).toEqual([]);
    await expect(applyMigrations(pg, [{ version: "0001_t", sql: "CREATE TABLE kk.t (a bigint);" }])).rejects.toThrow(
      "0001_t 已套用但內容被修改",
    );
    await pg.close();
  });
});
