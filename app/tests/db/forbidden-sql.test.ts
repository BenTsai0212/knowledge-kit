// 選項 B 的防護：切換資料庫角色、關閉 RLS 的語句只能出現在 app/src/db/database.ts（#6 決定 2）。
import { describe, expect, it } from "vitest";

const sources = import.meta.glob<string>("../../src/**/*.{ts,tsx,sql}", { query: "?raw", import: "default", eager: true });
const ALLOWED = "../../src/db/database.ts";

const FORBIDDEN = [
  /\bSET\s+(LOCAL\s+|SESSION\s+)?ROLE\b/i,
  /\bRESET\s+ROLE\b/i,
  /\bSET\s+(LOCAL\s+|SESSION\s+)?SESSION\s+AUTHORIZATION\b/i,
  /\brow_security\b/i,
  // set_config('role', …) 與 set_config('session_authorization', …) 等同 SET ROLE／SET SESSION AUTHORIZATION
  /\bset_config\s*\(\s*['"`]\s*(role|session_authorization)\s*['"`]/i,
];

const violations = (text: string) => FORBIDDEN.filter((re) => re.test(text)).map(String);

describe("app/src/ 不得切換資料庫角色或關閉 RLS", () => {
  it("規則能抓到被禁止的語句", () => {
    expect(violations("await tx.exec('reset role')")).toHaveLength(1);
    expect(violations("SET LOCAL ROLE kk_owner")).toHaveLength(1);
    expect(violations("set session authorization postgres")).toHaveLength(1);
    expect(violations("SET row_security = off")).toHaveLength(1);
    expect(violations("SELECT set_config('role', 'postgres', true)")).toHaveLength(1);
    expect(violations("select SET_CONFIG ( ' Role ' , 'postgres', false)")).toHaveLength(1);
    expect(violations("SELECT set_config('session_authorization', 'postgres', false)")).toHaveLength(1);
    expect(violations('tx.query(`select set_config( "session_authorization", $1, true)`)')).toHaveLength(1);
    expect(violations("SELECT set_config('kk.identity_id', $1, true)")).toEqual([]);
    expect(violations("ALTER TABLE kk.t FORCE ROW LEVEL SECURITY")).toEqual([]);
  });

  it("掃描範圍包含 app/src/ 的程式與 migration", () => {
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining([ALLOWED, "../../src/db/migrate.ts", "../../src/db/migrations/0002_rls.sql"]),
    );
  });

  it("除了 database.ts 以外都沒有出現", () => {
    const found = Object.entries(sources)
      .filter(([path]) => path !== ALLOWED)
      .flatMap(([path, text]) => violations(text).map((re) => `${path}: ${re}`));
    expect(found).toEqual([]);
  });
});
