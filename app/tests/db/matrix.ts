// 滲漏矩陣的共用部分：以資料層實際查詢每張表看得到的列，並與 oracle.ts 的預期比對。
import type { Database } from "../../src/db/database";
import { KEY_SQL, TABLE_KEYS, type Visible } from "./oracle";

export async function queryVisible(db: Database, identityId: string | null): Promise<Visible> {
  return db.withIdentity(identityId, async (tx) => {
    const out: Visible = {};
    for (const table of TABLE_KEYS) {
      const rows = await tx.query<{ k: string }>(`SELECT ${KEY_SQL[table]} AS k FROM kk.${table}`);
      out[table] = rows.rows.map((r) => r.k);
    }
    return out;
  });
}

// 滲漏 = 查得到但不該看到；漏看 = 該看到卻查不到
export function diff(actual: Visible, expected: Visible) {
  return TABLE_KEYS.map((table) => {
    const a = new Set(actual[table]);
    const e = new Set(expected[table]);
    return {
      table,
      leaked: [...a].filter((k) => !e.has(k)),
      missing: [...e].filter((k) => !a.has(k)),
    };
  });
}
