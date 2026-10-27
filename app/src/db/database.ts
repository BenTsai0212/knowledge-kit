// 資料層的唯一入口。切換資料庫角色只能寫在本檔（app/tests/db/forbidden-sql.test.ts 會檢查）。
//
// PGlite 的 session user 固定是 superuser postgres（以 username 選項連線也一樣，見 docs/data-model.md），
// 所以 app 的查詢在每個交易開頭以 SET LOCAL ROLE 切成 kk_app，並且不匯出 PGlite 本身。
import { PGlite, type PGliteInterface, type Transaction } from "@electric-sql/pglite";
import type { AccessFile } from "../client/types";
import { applyMigrations } from "./migrate";
import { seedAccess } from "./seed";

const BOOTSTRAP = `
  CREATE ROLE kk_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
  CREATE ROLE kk_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
  CREATE SCHEMA kk AUTHORIZATION kk_owner;
  CREATE SCHEMA kk_meta AUTHORIZATION kk_owner;
`;

export interface Database {
  // identityId 為 null 時不設定身分（所有資料表都查不到資料）
  withIdentity<T>(identityId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface OpenOptions {
  // 初始化時以 superuser 匯入資料（例如資料集、測試資料）；app 執行期間拿不到這個連線
  seed?: (db: PGliteInterface) => Promise<void>;
}

export async function openDatabase(config: { access: AccessFile }, options: OpenOptions = {}): Promise<Database> {
  const pg = await PGlite.create();
  await pg.exec(BOOTSTRAP);
  await pg.exec("SET ROLE kk_owner");
  await applyMigrations(pg);
  await pg.exec("RESET ROLE");
  await seedAccess(pg, config.access);
  if (options.seed) await options.seed(pg);
  // 交易外的查詢也以 kk_app 執行
  await pg.exec("SET ROLE kk_app");

  return {
    withIdentity(identityId, fn) {
      return pg.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE kk_app");
        if (identityId !== null) {
          await tx.query("SELECT set_config('kk.identity_id', $1, true)", [identityId]);
        }
        return fn(tx);
      });
    },
    close: () => pg.close(),
  };
}
