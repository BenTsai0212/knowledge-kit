// 滲漏矩陣：每個身分 × 每張表，比對 SQL 的結果與 oracle.ts 的預期。
// 滲漏 = 查得到但不該看到；漏看 = 該看到卻查不到。兩者都必須為 0，避免以「全部擋掉」通過。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { openDatabase, type Database } from "../../src/db/database";
import { expectedVisible, KEY_SQL, TABLE_KEYS, type Visible } from "./oracle";
import { sample, seedSample } from "./sample";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];

let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: seedSample });
});
afterAll(async () => {
  await db.close();
});

async function actualVisible(identityId: string | null): Promise<Visible> {
  return db.withIdentity(identityId, async (tx) => {
    const out: Visible = {};
    for (const table of TABLE_KEYS) {
      const rows = await tx.query<{ k: string }>(`SELECT ${KEY_SQL[table]} AS k FROM kk.${table}`);
      out[table] = rows.rows.map((r) => r.k);
    }
    return out;
  });
}

function diff(actual: Visible, expected: Visible) {
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

describe("滲漏矩陣", () => {
  it("每個身分 × 每張表：滲漏 0、漏看 0", async () => {
    const report: string[] = [];
    let leaked = 0;
    let missing = 0;
    for (const id of IDENTITIES) {
      const expected = expectedVisible(access, sample, id);
      const result = diff(await actualVisible(id), expected);
      for (const r of result) {
        leaked += r.leaked.length;
        missing += r.missing.length;
        expect(r.leaked, `${id} 在 ${r.table} 看到不該看到的列`).toEqual([]);
        expect(r.missing, `${id} 在 ${r.table} 漏看該看到的列`).toEqual([]);
      }
      report.push(`${String(id).padEnd(8)} ${TABLE_KEYS.map((t) => `${t}=${expected[t].length}`).join(" ")}`);
    }
    console.log(`權限滲漏 ${leaked}、漏看 ${missing}\n${report.join("\n")}`);
    expect({ leaked, missing }).toEqual({ leaked: 0, missing: 0 });
  });

  it("範例資料確實區分各身分（防止資料太少而通過）", () => {
    const v = Object.fromEntries(IDENTITIES.map((id) => [String(id), expectedVisible(access, sample, id)]));
    // 權限越大看得越多，且彼此不同
    for (const table of ["documents", "passages", "entities", "relations"] as const) {
      const [g, s, m] = ["guest", "staff", "manager"].map((id) => v[id][table].length);
      expect(g, table).toBeGreaterThan(0);
      expect(g, table).toBeLessThan(s);
      expect(s, table).toBeLessThan(m);
    }
    // 沒有身分、不存在的身分什麼都看不到
    for (const id of ["null", "nobody"]) {
      for (const table of TABLE_KEYS) expect(v[id][table], `${id} ${table}`).toEqual([]);
    }
    // 沒有出處的實體與關係、只有機密出處的實體，主管以外都看不到；沒有出處的連主管也看不到
    expect(v.manager.entities).not.toContain("e-orphan");
    expect(v.manager.relations).not.toContain("r-orphan");
    expect(v.staff.entities).not.toContain("e-confidential-only");
    expect(v.manager.entities).toContain("e-confidential-only");
  });
});

describe("各身分的可見範圍", () => {
  const ids = (identity: string, table: string) =>
    db.withIdentity(identity, async (tx) =>
      (await tx.query<{ k: string }>(`SELECT ${KEY_SQL[table as keyof typeof KEY_SQL]} AS k FROM kk.${table} ORDER BY 1`)).rows.map(
        (r) => r.k,
      ),
    );

  it("訪客只看得到公開且沒有專案的文件", async () => {
    expect(await ids("guest", "documents")).toEqual(["doc-public-none"]);
    // 同一份文件中較機密的段落看不到
    expect(await ids("guest", "passages")).toEqual(["doc-public-none-p0"]);
  });

  it("一般員工看得到內部等級以下、沒有專案或極光專案的文件", async () => {
    expect(await ids("staff", "documents")).toEqual([
      "doc-internal-aurora",
      "doc-internal-none",
      "doc-public-aurora",
      "doc-public-none",
    ]);
  });

  it("段落要同時看得到所屬文件，且符合自己的專案", async () => {
    // 機密文件中的公開段落：一般員工看不到
    expect(await ids("staff", "passages")).not.toContain("doc-confidential-none-p1");
    expect(await ids("manager", "passages")).toContain("doc-confidential-none-p1");
    // 極光專案文件中屬於港灣專案的段落：一般員工看不到
    expect(await ids("staff", "passages")).not.toContain("doc-public-aurora-p1");
  });

  it("關係要有看得到的出處，且兩端的實體都看得到", async () => {
    expect(await ids("guest", "relations")).toEqual(["r-public"]);
    expect(await ids("staff", "relations")).toEqual(["r-aurora", "r-public"]);
    expect(await ids("manager", "relations")).toEqual(["r-aurora", "r-cross-project", "r-hidden-endpoint", "r-public"]);
  });
});

describe("關係的出處", () => {
  // 0003_relation_sources_endpoints.sql：出處列帶上兩端實體，兩端都看得到才看得到出處
  it("關係被隱藏時，出處列也看不到", async () => {
    const rows = await db.withIdentity("guest", async (tx) => ({
      relations: (await tx.query("SELECT id FROM kk.relations WHERE id = 'r-hidden-endpoint'")).rows.length,
      sources: (await tx.query("SELECT relation_id FROM kk.relation_sources WHERE relation_id = 'r-hidden-endpoint'")).rows.length,
    }));
    expect(rows).toEqual({ relations: 0, sources: 0 });
    // 主管看得到兩端，所以關係與出處都看得到
    const manager = await db.withIdentity("manager", async (tx) =>
      (await tx.query("SELECT 1 FROM kk.relation_sources WHERE relation_id = 'r-hidden-endpoint'")).rows.length,
    );
    expect(manager).toBe(1);
  });

  it("出處列的兩端必須與關係一致", async () => {
    const mismatch = openDatabase(clientConfig, {
      seed: async (pg) => {
        await seedSample(pg);
        await pg.query(
          "INSERT INTO kk.relation_sources (relation_id, passage_id, from_entity_id, to_entity_id) VALUES ($1, $2, $3, $4)",
          ["r-public", "doc-internal-none-p0", "e-aurora", "e-mixed"],
        );
      },
    });
    await expect(mismatch).rejects.toThrow("relation_sources_relation_endpoints_fkey");
  });
});

describe("切換身分", () => {
  it("依序切換後，每次的結果都等於該身分的預期", async () => {
    for (const id of ["guest", "manager", "guest", "staff", null, "manager"]) {
      const result = diff(await actualVisible(id), expectedVisible(access, sample, id));
      expect(result.flatMap((r) => [...r.leaked, ...r.missing]), String(id)).toEqual([]);
    }
  });

  it("同時進行的不同身分查詢互不影響", async () => {
    const order = ["manager", "guest", "staff", "guest", "manager"];
    const results = await Promise.all(order.map((id) => actualVisible(id)));
    results.forEach((actual, i) => {
      const result = diff(actual, expectedVisible(access, sample, order[i]));
      expect(result.flatMap((r) => [...r.leaked, ...r.missing]), order[i]).toEqual([]);
    });
  });
});
