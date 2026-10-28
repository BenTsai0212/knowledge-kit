// 參考資料集（client/data/）轉成 oracle.ts 的輸入形狀：段落套用沿用規則（docs/dataset.md）。
import { dataset } from "../../src/dataset/load";
import type { Sample } from "./sample";

const documents = Object.values(dataset.documents);

export const datasetSample: Sample = {
  docs: documents.map((d) => ({ id: d.id, level: d.visibility, project: d.project ?? null })),
  passages: documents.flatMap((d) =>
    d.passages.map((p) => ({ id: p.id, doc: d.id, level: p.visibility ?? d.visibility, project: p.project ?? d.project ?? null })),
  ),
  entities: dataset.entities.entities.map((e) => ({ id: e.id, sources: e.sources })),
  relations: dataset.relations.relations.map((r) => ({ id: r.id, from: r.from, to: r.to, sources: r.sources })),
};
