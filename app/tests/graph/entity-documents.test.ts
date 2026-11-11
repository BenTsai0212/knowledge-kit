// 實體面板「出現的文件」的原文片段（#240）：只取目前身分看得到的段落（readGraph() 經 withIdentity()／RLS），
// 文件中看不到的段落不出現、也不標示被省略（#247）。以 oracle.ts 算出的可見段落比對，並涵蓋「文件有部分段落看不到」的身分。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { dataset } from "../../src/dataset/load";
import { seedDataset } from "../../src/dataset/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { datasetSample } from "../../src/evals/oracle";
import { readGraph } from "../../src/graph/read";
import { entityDocuments } from "../../src/ui/graph-labels";
import { expectedVisible } from "../db/oracle";

const access = clientConfig.access;
const IDENTITIES = [...access.roles.map((r) => r.id), null];
const LANGUAGES = clientConfig.client.languages;
const sample = datasetSample(dataset);
const passageText = new Map(Object.values(dataset.documents).flatMap((d) => d.passages.map((p) => [p.id, p.text] as const)));
const documentOf = new Map(sample.passages.map((p) => [p.id, p.doc]));

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
});
afterAll(async () => {
  await db.close();
});

// 實體的出處中，所屬文件看得到、但段落本身看不到的組合（「文件有部分段落看不到」）
function partlyHidden(identity: string | null): { entity: string; document: string; hidden: string }[] {
  const visible = expectedVisible(access, sample, identity);
  const passages = new Set(visible.passages);
  const documents = new Set(visible.documents);
  const entities = new Set(visible.entities);
  return dataset.entities.entities
    .filter((e) => entities.has(e.id))
    .flatMap((e) =>
      e.sources
        .filter((s) => !passages.has(s) && documents.has(documentOf.get(s)!))
        .map((s) => ({ entity: e.id, document: documentOf.get(s)!, hidden: s })),
    );
}

describe("實體面板的原文片段", () => {
  it.each(IDENTITIES.map((id) => [String(id), id] as const))("%s：片段只來自看得到的段落，內容與段落原文相同", async (_name, id) => {
    const graph = await readGraph(db, id);
    const visible = new Set(expectedVisible(access, sample, id).passages);
    for (const language of LANGUAGES) {
      for (const entity of graph.entities) {
        for (const doc of entityDocuments(entity, language)) {
          for (const p of doc.passages) {
            expect(visible.has(p.id), `${entity.id} ${p.id}`).toBe(true);
            expect(documentOf.get(p.id)).toBe(doc.documentId);
            // 片段就是段落原文：不加「已省略」之類的文字
            expect(p.segments.map((s) => s.text).join("")).toBe(passageText.get(p.id));
          }
        }
      }
    }
  });

  it("文件有部分段落看不到的身分：看不到的段落不出現，同一份文件看得到的段落照常出現", async () => {
    const cases = IDENTITIES.flatMap((id) => partlyHidden(id).map((c) => ({ id, ...c })));
    // 資料集要有這種情況，否則測試會以空集合通過
    expect(cases.length).toBeGreaterThan(0);
    for (const { id, entity, document, hidden } of cases) {
      const graph = await readGraph(db, id);
      const e = graph.entities.find((x) => x.id === entity)!;
      const shown = LANGUAGES.flatMap((language) => entityDocuments(e, language)).flatMap((d) => d.passages.map((p) => p.id));
      expect(shown, `${String(id)} ${entity}`).not.toContain(hidden);
      // 同一份文件中看得到的出處段落照常出現（介面語言與段落語言相同時）
      const visible = new Set(expectedVisible(access, sample, id).passages);
      const sameDocument = e.sources.filter((s) => documentOf.get(s.id) === document && visible.has(s.id)).map((s) => s.id);
      for (const p of sameDocument) expect(shown).toContain(p);
      // 看得最多的身分看得到同一段：確認差別來自權限，而不是面板本身沒有列出
      const manager = await readGraph(db, "manager");
      const all = LANGUAGES.flatMap((language) => entityDocuments(manager.entities.find((x) => x.id === entity)!, language));
      expect(all.flatMap((d) => d.passages.map((p) => p.id))).toContain(hidden);
    }
  });

  it("片段中的實體名稱以 mark 標出", async () => {
    const graph = await readGraph(db, "manager");
    const entity = graph.entities.find((e) => e.sources.some((s) => s.content.includes(e.name)))!;
    const segments = entityDocuments(entity, entity.sources[0].language).flatMap((d) => d.passages.flatMap((p) => p.segments));
    expect(segments.filter((s) => s.mark).map((s) => s.text)).toContain(entity.name);
  });
});
