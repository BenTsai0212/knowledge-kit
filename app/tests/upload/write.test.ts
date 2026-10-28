// 越權寫入：每個身分嘗試寫入每種「可見等級 × 專案（含無專案）」，結果必須正好等於 oracle.ts 的 canWrite()。
// 也測試偽造上傳者、段落加到別人的文件、等級或專案與文件不同、UPDATE／DELETE。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { uploadDocument, UploadError, type UploadInput } from "../../src/upload/write";
import { canWrite } from "../db/oracle";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];
const LEVELS = access.visibilityLevels.map((l) => l.id);
const PROJECTS = [null, ...access.projects.map((p) => p.id)];
const OPTIONS = { languages: clientConfig.client.languages };

const input = (visibility: string, project: string | null): UploadInput => ({
  title: "虛構的測試文件",
  language: "zh-TW",
  visibility,
  project,
  date: "2026-10-28",
  passages: ["這是一段虛構的測試內容。", "第二段虛構內容。"],
});

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

// 依序嘗試每種組合，回傳成功的組合
async function writable(database: Database, identityId: string | null) {
  const ok: string[] = [];
  for (const level of LEVELS) {
    for (const project of PROJECTS) {
      try {
        await uploadDocument(database, identityId, input(level, project), OPTIONS);
        ok.push(`${level}|${project}`);
      } catch (e) {
        if (!(e instanceof UploadError && e.reason === "denied")) throw e;
      }
    }
  }
  return ok;
}
const expected = (identityId: string | null) =>
  LEVELS.flatMap((level) => PROJECTS.filter((project) => canWrite(access, identityId, level, project)).map((project) => `${level}|${project}`));

// 以 superuser 以外的方式無法數到所有文件，所以用主管（看得到全部）計算上傳的文件數
const uploadedCount = () =>
  db.withIdentity("manager", async (tx) => (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM kk.documents WHERE id LIKE 'upload-%'")).rows[0].n);

describe("越權寫入", () => {
  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：能寫入的組合正好等於 oracle 的規則", async (_name, id) => {
    const before = await uploadedCount();
    const ok = await writable(db, id);
    expect(ok).toEqual(expected(id));
    // 被拒絕的組合沒有留下任何文件
    expect(await uploadedCount()).toBe(before + ok.length);
  });

  it("規則確實區分各身分（防止以全部拒絕或全部允許而通過）", () => {
    const [guest, staff, manager] = ["guest", "staff", "manager"].map((id) => expected(id).length);
    expect(guest).toBe(0);
    expect(staff).toBeGreaterThan(0);
    expect(staff).toBeLessThan(manager);
    // 主管有最高等級與所有專案
    expect(manager).toBe(LEVELS.length * PROJECTS.length);
  });

  it("檢查能抓到越權：忽略身分、一律以主管寫入的資料層會被抓到", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    for (const id of ["guest", "staff", null]) expect(await writable(ignoring, id), String(id)).not.toEqual(expected(id));
  });
});

describe("偽造上傳者與段落的規則", () => {
  const insertDocument = (identityId: string | null, id: string, uploadedBy: string | null, level = "public") =>
    db.withIdentity(identityId, (tx) =>
      tx.query(
        "INSERT INTO kk.documents (id, title, language, visibility_level_id, project_id, uploaded_by) VALUES ($1, 'x', 'zh-TW', $2, NULL, $3)",
        [id, level, uploadedBy],
      ),
    );
  const insertPassage = (identityId: string, id: string, documentId: string, level = "public", project: string | null = null) =>
    db.withIdentity(identityId, (tx) =>
      tx.query(
        "INSERT INTO kk.passages (id, document_id, ordinal, language, content, visibility_level_id, project_id) VALUES ($1, $2, 99, 'zh-TW', 'x', $3, $4)",
        [id, documentId, level, project],
      ),
    );

  it("把 uploaded_by 設為其他身分或 NULL → 拒絕", async () => {
    await expect(insertDocument("staff", "forged-1", "manager")).rejects.toThrow(/row-level security/);
    await expect(insertDocument("staff", "forged-2", null)).rejects.toThrow(/row-level security/);
    await expect(insertDocument("staff", "own-1", "staff")).resolves.toBeDefined();
  });

  it("沒有身分時，uploaded_by 為任何值都拒絕", async () => {
    for (const [i, by] of ["manager", "staff", "guest", null].entries()) {
      await expect(insertDocument(null, `no-identity-${i}`, by), String(by)).rejects.toThrow(/row-level security/);
    }
  });

  it("段落加到資料集的文件或其他身分上傳的文件 → 拒絕", async () => {
    await expect(insertPassage("staff", "p-handbook", "employee-handbook-zh")).rejects.toThrow(/row-level security/);
    const { documentId } = await uploadDocument(db, "manager", input("internal", null), OPTIONS);
    await expect(insertPassage("staff", "p-other", documentId, "internal")).rejects.toThrow(/row-level security/);
  });

  it("段落的等級或專案與文件不同 → 拒絕；相同時成功", async () => {
    const { documentId } = await uploadDocument(db, "staff", input("internal", "bluewing"), OPTIONS);
    await expect(insertPassage("staff", "p-level", documentId, "public", "bluewing")).rejects.toThrow(/row-level security/);
    await expect(insertPassage("staff", "p-project", documentId, "internal", null)).rejects.toThrow(/row-level security/);
    await expect(insertPassage("staff", "p-same", documentId, "internal", "bluewing")).resolves.toBeDefined();
  });

  it("UPDATE、DELETE 沒有權限，實體與關係也不能寫入", async () => {
    for (const sql of [
      "UPDATE kk.documents SET title = 'x'",
      "DELETE FROM kk.passages",
      "INSERT INTO kk.entities (id, entity_type, name) VALUES ('x', 'person', 'x')",
      "INSERT INTO kk.relations (id, relation_type, from_entity_id, to_entity_id) VALUES ('x', 'leads', 'a', 'b')",
    ]) {
      await expect(db.withIdentity("manager", (tx) => tx.exec(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });
});

describe("uploadDocument 的格式檢查與 id", () => {
  it("語言不在 languages、日期格式錯誤、標題或段落為空 → invalid，不寫入", async () => {
    const before = await uploadedCount();
    for (const bad of [
      { ...input("public", null), language: "ja" },
      { ...input("public", null), date: "2026/10/28" },
      { ...input("public", null), title: "  " },
      { ...input("public", null), passages: ["", "  "] },
    ]) {
      await expect(uploadDocument(db, "manager", bad, OPTIONS)).rejects.toMatchObject({ reason: "invalid" });
    }
    expect(await uploadedCount()).toBe(before);
  });

  it("文件與段落 id 不與資料集或其他上傳重複；日期與上傳者寫入資料庫", async () => {
    const a = await uploadDocument(db, "staff", input("public", null), OPTIONS);
    const b = await uploadDocument(db, "staff", input("public", null), OPTIONS);
    expect(a.documentId).not.toBe(b.documentId);
    expect(a.documentId).toMatch(/^upload-[0-9a-f-]{36}$/);
    expect(a.passageIds).toEqual([`${a.documentId}-1`, `${a.documentId}-2`]);
    const datasetIds = new Set(Object.values(dataset.documents).flatMap((d) => [d.id, ...d.passages.map((p) => p.id)]));
    expect([a.documentId, ...a.passageIds].filter((id) => datasetIds.has(id))).toEqual([]);
    const row = await db.withIdentity("staff", async (tx) =>
      (
        await tx.query<{ date: string; uploaded_by: string }>(
          "SELECT to_char(document_date, 'YYYY-MM-DD') AS date, uploaded_by FROM kk.documents WHERE id = $1",
          [a.documentId],
        )
      ).rows[0],
    );
    expect(row).toEqual({ date: "2026-10-28", uploaded_by: "staff" });
  });
});
