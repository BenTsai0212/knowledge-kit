// 以 kk_app 嘗試關閉或繞過 RLS。用到被禁止的語句，所以放在 app/src/ 之外（見 forbidden-sql.test.ts）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { openDatabase, type Database } from "../../src/db/database";
import { seedBasic } from "../../src/db/test-fixtures";

let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: seedBasic });
});
afterAll(async () => {
  await db.close();
});

const attempt = (sql: string) => db.withIdentity("staff", (tx) => tx.exec(sql));

describe("kk_app 無法關閉 RLS", () => {
  it.each([
    ["DISABLE ROW LEVEL SECURITY", "ALTER TABLE kk.documents DISABLE ROW LEVEL SECURITY", "must be owner"],
    ["NO FORCE ROW LEVEL SECURITY", "ALTER TABLE kk.documents NO FORCE ROW LEVEL SECURITY", "must be owner"],
    ["DROP POLICY", "DROP POLICY can_see ON kk.documents", "must be owner"],
    ["CREATE POLICY", "CREATE POLICY open ON kk.documents FOR SELECT USING (true)", "must be owner"],
    ["row_security = off", "SET LOCAL row_security = off; SELECT * FROM kk.documents", "row-level security"],
    ["寫入資料", "INSERT INTO kk.projects (id) VALUES ('x')", "permission denied"],
    // 非擁有者的 GRANT 只會發出警告，所以接著寫入確認權限沒有生效
    ["授予自己權限", "GRANT INSERT ON kk.projects TO kk_app; INSERT INTO kk.projects (id) VALUES ('x')", "permission denied"],
  ])("%s 失敗", async (_name, sql, message) => {
    await expect(attempt(sql)).rejects.toThrow(message);
  });

  it("失敗之後 RLS 仍然有效", async () => {
    const ids = await db.withIdentity("guest", async (tx) => (await tx.query<{ id: string }>("SELECT id FROM kk.documents")).rows);
    expect(ids).toEqual([{ id: "doc-handbook" }]);
  });

  it("無法以條件讀到其他身分的資料", async () => {
    const rows = await db.withIdentity("guest", async (tx) => ({
      documents: (await tx.query("SELECT * FROM kk.documents WHERE project_id = 'aurora'")).rows.length,
      identities: (await tx.query("SELECT * FROM kk.identities WHERE id <> 'guest'")).rows.length,
    }));
    expect(rows).toEqual({ documents: 0, identities: 0 });
  });
});

describe("已知限制（選項 B）", () => {
  // PGlite 的 session user 是 superuser，RESET ROLE 或以 set_config 設定 role、session_authorization 都能回到 superuser 而繞過 RLS。
  // 這由 forbidden-sql.test.ts 禁止 app/src/ 寫入這類語句來防範；本測試在 PGlite 行為改變時提醒更新文件。
  it.each([
    ["RESET ROLE", "RESET ROLE"],
    ["set_config('role', …)", "SELECT set_config('role', 'postgres', true)"],
    ["set_config('session_authorization', …)", "SELECT set_config('session_authorization', 'postgres', true)"],
  ])("%s 會回到 superuser", async (_name, sql) => {
    const row = await db.withIdentity("guest", async (tx) => {
      await tx.exec(sql);
      return (await tx.query<{ me: string; n: number }>("SELECT current_user AS me, (SELECT count(*)::int FROM kk.documents) AS n")).rows[0];
    });
    expect(row).toEqual({ me: "postgres", n: 2 });
  });
});
