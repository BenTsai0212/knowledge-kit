// 越權測試用的資料集（#66）：在 Node 端讀出 client/data/，以 app/src/evals/oracle.ts 的 expectedVisible() 算出每個身分看不到的段落。
// 畫面上的文字以段落開頭的一段比對，避免空白與換行的差異造成誤判。
import { readdirSync, readFileSync } from "node:fs";
import type { AccessFile } from "../../app/src/client/types";
import type { DatasetDocument, EntitiesFile, RelationsFile } from "../../app/src/dataset/types";
import { datasetSample, expectedVisible } from "../../app/src/evals/oracle";
import access from "../../client/access.json" with { type: "json" };
import entities from "../../client/data/entities.json" with { type: "json" };
import relations from "../../client/data/relations.json" with { type: "json" };
import type { RoleId } from "./app";

// Playwright 在 repo 根目錄執行
const DOCUMENTS_DIR = "client/data/documents";
const PREFIX_LENGTH = 20;

const documents = readdirSync(DOCUMENTS_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`${DOCUMENTS_DIR}/${f}`, "utf8")) as DatasetDocument);
const sample = datasetSample({
  root: "data/",
  documents: Object.fromEntries(documents.map((d) => [d.id, d])),
  entities: entities as EntitiesFile,
  relations: relations as RelationsFile,
});

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const passages = documents.flatMap((d) => d.passages.map((p) => ({ id: p.id, text: normalize(p.text) })));

const visible = (role: RoleId) => new Set(expectedVisible(access as AccessFile, sample, role).passages);

// 看不到的段落與比對用的開頭；開頭也出現在看得到的段落中的不算（無法分辨）
export function hiddenPassages(role: RoleId): { id: string; prefix: string }[] {
  const seen = visible(role);
  const shown = passages.filter((p) => seen.has(p.id));
  return passages
    .filter((p) => !seen.has(p.id))
    .map((p) => ({ id: p.id, prefix: p.text.slice(0, PREFIX_LENGTH) }))
    .filter((p) => !shown.some((v) => v.text.includes(p.prefix)));
}

// 畫面文字中出現的、該身分看不到的段落 id
export function leakedPassages(pageText: string, role: RoleId): string[] {
  const text = normalize(pageText);
  return hiddenPassages(role)
    .filter((p) => text.includes(p.prefix))
    .map((p) => p.id);
}

// 介面語言的文件中，manager 看得到、但該身分一段都看不到的一份（打開原文後切換身分用）
export function hiddenDocument(role: RoleId, language: string): string {
  const seen = visible(role);
  const manager = visible("manager");
  const doc = documents.find((d) => d.language === language && d.passages.every((p) => !seen.has(p.id) && manager.has(p.id)));
  if (doc === undefined) throw new Error(`資料集中沒有 ${role} 完全看不到的 ${language} 文件`);
  return doc.id;
}
