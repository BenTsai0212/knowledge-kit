// 首頁「可能答得出來了」的權限（#408、#247）：各身分各問一題被拒答 → 主管上傳各等級與專案的相關文件 →
// 以目前身分重查。帶來變化的文件一定在該身分的可見範圍內（oracle 比對），看不到的文件不提示；不同身分的結果不同（避免以空結果通過）。
// 另外以實際的 retrieve() 驗證未達 minScore 的段落不算，以及快取鍵 visiblePassagesKey()
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { datasetSample } from "../../src/evals/oracle";
import { keywordHashProvider } from "../../src/retrieval/keyword-hash";
import { createRetriever, openRetriever, visiblePassagesKey, type Retriever } from "../../src/retrieval/retrieve";
import { recheckRefused, rememberOutcome, rememberQuestion, type AskedQuestion } from "../../src/ui/home";
import { uploadDocument } from "../../src/upload/write";
import { expectedVisible } from "../db/oracle";
import type { Sample } from "../db/sample";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null, "nobody"];
const QUESTION = "員工停車證怎麼辦理？";
const CONTENT = "員工停車證向總務處辦理，填寫停車證申請表即可。";
// 各等級與專案各一份（虛構內容）
const UPLOADS = [
  { visibility: "public", project: null },
  { visibility: "internal", project: null },
  { visibility: "internal", project: "bluewing" },
  { visibility: "confidential", project: null },
  { visibility: "internal", project: "longpier" },
] as const;

const fresh = () => openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
const upload = (db: Database, u: { visibility: string; project: string | null }, title: string, passages = [CONTENT]) =>
  uploadDocument(db, "manager", { title, language: "zh-TW", date: null, passages, ...u }, { languages: ["zh-TW"] });

// 拒答當時記下的問過的問題（seen 是那時以該身分檢索到的段落）
async function refusedAs(retriever: Retriever, identity: string | null): Promise<AskedQuestion[]> {
  const asked = rememberQuestion([], QUESTION, "2026-11-10T09:00:00.000Z");
  return rememberOutcome(asked, QUESTION, { refused: true, retrieved: (await retriever.retrieve(identity, QUESTION)).map((p) => p.id) });
}
const recheckAs = (retriever: Retriever, identity: string | null, asked: AskedQuestion[]) =>
  recheckRefused(asked, (q) => retriever.retrieve(identity, q));

describe("重查只算看得到的（#247）", { timeout: 30_000 }, () => {
  let db: Database;
  let retriever: Retriever;
  let sample: Sample;
  const before = new Map<string | null, AskedQuestion[]>();

  beforeAll(async () => {
    db = await fresh();
    retriever = openRetriever(db, clientConfig.client.retrieval);
    for (const id of IDENTITIES) before.set(id, await refusedAs(retriever, id));
    const base = datasetSample(dataset);
    sample = { ...base, docs: [...base.docs], passages: [...base.passages] };
    for (const [i, u] of UPLOADS.entries()) {
      const { documentId, passageIds } = await upload(db, u, `停車證辦理 ${i + 1}`);
      sample.docs.push({ id: documentId, level: u.visibility, project: u.project });
      sample.passages.push(...passageIds.map((id) => ({ id, doc: documentId, level: u.visibility, project: u.project })));
    }
  });
  afterAll(async () => {
    await db.close();
  });

  it("帶來變化的文件一定在該身分的可見範圍內；看得到新文件的身分才提示", async () => {
    const changed = new Map<string | null, string | null>();
    for (const id of IDENTITIES) {
      const visibleDocs = new Set(expectedVisible(access, sample, id).documents);
      const newVisible = sample.docs.slice(-UPLOADS.length).some((d) => visibleDocs.has(d.id));
      const found = await recheckAs(retriever, id, before.get(id)!);
      expect(found.length, String(id)).toBe(newVisible ? 1 : 0);
      for (const f of found) expect(visibleDocs.has(f.document.id), `${id}：${f.document.id}`).toBe(true);
      for (const f of found) expect(f.retrieved.every((p) => new Set(expectedVisible(access, sample, id).passages).has(p)), String(id)).toBe(true);
      changed.set(id, found[0]?.document.id ?? null);
    }
    // 不同身分的結果不同：訪客只看得到公開的那份，沒有身分與不存在的身分不提示
    expect(changed.get("guest")).not.toBeNull();
    expect(changed.get(null)).toBeNull();
    expect(changed.get("nobody")).toBeNull();
    const reachable = (id: string) => new Set(expectedVisible(access, sample, id).documents);
    expect(reachable("guest").size).toBeLessThan(reachable("staff").size);
    expect(reachable("staff").size).toBeLessThan(reachable("manager").size);
  });

  it("檢查能抓到滲漏：忽略身分、一律以主管檢索時，訪客會被提示看不到的文件", async () => {
    const ignoring: Database = { withIdentity: (_id, fn) => db.withIdentity("manager", fn), close: db.close };
    const leaky = openRetriever(ignoring, clientConfig.client.retrieval);
    const visibleDocs = new Set(expectedVisible(access, sample, "guest").documents);
    const found = await recheckAs(leaky, "guest", before.get("guest")!);
    const all = found.flatMap((f) => f.retrieved).map((p) => sample.passages.find((x) => x.id === p)!.doc);
    expect(all.some((d) => !visibleDocs.has(d))).toBe(true);
  });

  it("快取鍵依身分：看得到的段落不同時不同", async () => {
    const keys = await Promise.all(["guest", "staff", "manager"].map((id) => visiblePassagesKey(db, id)));
    expect(new Set(keys).size).toBe(3);
    expect(keys[0].startsWith(`${expectedVisible(access, sample, "guest").passages.length}:`)).toBe(true);
  });
});

describe("重查：實際的 retrieve()", { timeout: 30_000 }, () => {
  let db: Database;
  beforeAll(async () => {
    db = await fresh();
  });
  afterAll(async () => {
    await db.close();
  });

  it("未達 minScore 的新段落不算", async () => {
    const asked = await refusedAs(openRetriever(db, clientConfig.client.retrieval), "manager");
    await upload(db, { visibility: "public", project: null }, "停車證", [CONTENT]);
    // 門檻高到沒有段落能達到時不提示；門檻是設定值時提示
    const strict = createRetriever(db, keywordHashProvider, { topK: 5, minScore: 1.01 });
    expect(await recheckAs(strict, "manager", asked)).toEqual([]);
    expect(await recheckAs(openRetriever(db, clientConfig.client.retrieval), "manager", asked)).toHaveLength(1);
  });
});

describe("visiblePassagesKey（快取鍵）", { timeout: 30_000 }, () => {
  it("新增文件時改變；資料沒有變化時相同", async () => {
    const db = await fresh();
    const key = await visiblePassagesKey(db, "staff");
    expect(await visiblePassagesKey(db, "staff")).toBe(key);
    await upload(db, { visibility: "internal", project: null }, "停車證");
    expect(await visiblePassagesKey(db, "staff")).not.toBe(key);
    await db.close();
  });

  it("撤回一份、新增一份、段落數相同時仍會重查（id 不同，鍵不同）", async () => {
    // 撤回 A、新增 B 之後看得到的段落：與「資料集＋A」的段落數相同，id 不同
    const [a, b] = [await fresh(), await fresh()];
    await upload(a, { visibility: "internal", project: null }, "甲");
    await upload(b, { visibility: "internal", project: null }, "乙");
    const [ka, kb] = [await visiblePassagesKey(a, "staff"), await visiblePassagesKey(b, "staff")];
    expect(ka.split(":")[0]).toBe(kb.split(":")[0]);
    expect(ka).not.toBe(kb);
    await Promise.all([a.close(), b.close()]);
  });
});
