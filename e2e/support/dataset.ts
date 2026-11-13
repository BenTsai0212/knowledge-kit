// 越權測試用的資料集（#66）：在 Node 端讀出選定客戶的 data/（#77），以 app/src/evals/oracle.ts 的 expectedVisible() 算出每個身分看不到的段落。
// 畫面上的文字以段落開頭的一段比對，避免空白與換行的差異造成誤判。
import { readdirSync, readFileSync } from "node:fs";
import type { DatasetDocument, EntitiesFile, RelationsFile } from "../../app/src/dataset/types";
import { datasetSample, expectedVisible } from "../../app/src/evals/oracle";
import type { Graph } from "../../app/src/graph/read";
import type { RoleId } from "./app";
import { access, clientDir, readClientJson } from "./client";

const DOCUMENTS_DIR = `${clientDir}/data/documents`;
const PREFIX_LENGTH = 20;

const documents = readdirSync(DOCUMENTS_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`${DOCUMENTS_DIR}/${f}`, "utf8")) as DatasetDocument);
const entities = readClientJson<EntitiesFile>("data/entities.json").entities;
const relationsFile = readClientJson<RelationsFile>("data/relations.json");
const sample = datasetSample({
  root: "data/",
  documents: Object.fromEntries(documents.map((d) => [d.id, d])),
  entities: { entities },
  relations: relationsFile,
});

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const passages = documents.flatMap((d) => d.passages.map((p) => ({ id: p.id, text: normalize(p.text) })));

const visible = (role: RoleId) => new Set(expectedVisible(access, sample, role).passages);

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

// 介面語言的文件中，viewer 看得到、但該身分一段都看不到的一份（打開原文後切換身分用）；沒有時是 undefined
export function hiddenDocument(role: RoleId, viewer: RoleId, language: string): string | undefined {
  const seen = visible(role);
  const shown = visible(viewer);
  return documents.find((d) => d.language === language && d.passages.every((p) => !seen.has(p.id) && shown.has(p.id)))?.id;
}

// 「回答提到」用（#195）：實體在介面語言的顯示名稱（與 app/src/ui/graph-labels.ts 的 entityName() 相同）
const displayName = (e: (typeof entities)[number], language: string) => e.names[language] || e.name;

// 所有實體的顯示名稱（假的回答寫出全部名稱，包括看不到的）
export const allEntityNames = (language: string): string[] => [...new Set(entities.map((e) => displayName(e, language)))];

// 該身分看得到的實體名稱；看不到的實體中，名稱與看得到的實體都不同的名稱；
// 以及看得到、名稱不與其他實體重複、而且有看得到的關係的實體名稱（點了之後實體面板有關係與接著問）
export function entityNames(role: RoleId, language: string): { visible: string[]; hidden: string[]; connected: string[] } {
  const v = expectedVisible(access, sample, role);
  const seen = new Set(v.entities);
  const visible = [...new Set(entities.filter((e) => seen.has(e.id)).map((e) => displayName(e, language)))];
  const hidden = [...new Set(entities.filter((e) => !seen.has(e.id)).map((e) => displayName(e, language)))].filter((n) => !visible.includes(n));
  const related = new Set(sample.relations.filter((r) => v.relations.includes(r.id)).flatMap((r) => [r.from, r.to]));
  const count = (name: string) => entities.filter((e) => displayName(e, language) === name).length;
  const connected = entities.filter((e) => related.has(e.id) && count(displayName(e, language)) === 1).map((e) => displayName(e, language));
  return { visible, hidden, connected };
}

// 拒答的「可以試試」用（#285）：文字中提到的、該身分看得到的實體名稱，依第一次出現的位置排列（同一位置時主要名稱長的在前）。
// 比對方式與 app/src/ui/mentions.ts 的 firstMention() 相同：主要名稱與各語言的名稱任一出現即可，不分大小寫；回傳實際出現的那個名稱
export function visibleNamesIn(text: string, role: RoleId): string[] {
  const seen = new Set(expectedVisible(access, sample, role).entities);
  const lower = text.toLowerCase();
  return entities
    .filter((e) => seen.has(e.id))
    .flatMap((e) => {
      const hits = [e.name, ...Object.values(e.names)]
        .filter((n) => n.trim() !== "")
        .map((n) => ({ n, at: lower.indexOf(n.toLowerCase()) }))
        .filter((x) => x.at >= 0)
        .sort((a, b) => a.at - b.at);
      return hits.length === 0 ? [] : [{ name: hits[0].n, at: hits[0].at, length: e.name.length }];
    })
    .sort((a, b) => a.at - b.at || b.length - a.length)
    .map((x) => x.name);
}

// 同名的實體（#198）：該身分看得到、顯示名稱相同的實體 id，每組至少兩個（參考情境是兩位林志明）
export function sameNameEntities(role: RoleId, language: string): { name: string; ids: string[] }[] {
  const seen = new Set(expectedVisible(access, sample, role).entities);
  const groups = new Map<string, string[]>();
  for (const e of entities.filter((x) => seen.has(x.id))) groups.set(displayName(e, language), [...(groups.get(displayName(e, language)) ?? []), e.id]);
  return [...groups].filter(([, ids]) => ids.length > 1).map(([name, ids]) => ({ name, ids }));
}

// viewer 看得到 role 看得到的所有段落（role 的回報送出的段落都在其中，viewer 才看得到該回報，ADR 0007 決定 7）
export function seesAllOf(viewer: RoleId, role: RoleId): boolean {
  const shown = visible(viewer);
  return [...visible(role)].every((id) => shown.has(id));
}

// 該身分看得到的圖（與 readGraph() 回傳的形狀相同，出處省略）：大量節點時的門檻與清單的分群（#254）用它算期望值
export function visibleGraph(role: RoleId): Graph {
  const v = expectedVisible(access, sample, role);
  const seen = new Set(v.entities);
  const shown = new Set(v.relations);
  return {
    entities: entities.filter((e) => seen.has(e.id)).map((e) => ({ id: e.id, type: e.type, name: e.name, names: e.names, sources: [] })),
    relations: relationsFile.relations.filter((r) => shown.has(r.id)).map((r) => ({ id: r.id, type: r.type, from: r.from, to: r.to, sources: [] })),
  };
}

// 身分對照（#261）：介面語言的段落中，只有一個身分看得到的那些段落比對用的開頭，以及看得到它們的身分。
// 沒有任何段落是介面語言、或不只一個身分看得到時是 null
export function onlyOneSees(passageIds: readonly string[], language: string): { role: RoleId; prefixes: string[] } | null {
  const inLanguage = documents.filter((d) => d.language === language).flatMap((d) => d.passages.map((p) => p.id));
  const ids = passageIds.filter((id) => inLanguage.includes(id));
  const seers = access.roles.filter((r) => ids.some((id) => visible(r.id).has(id)));
  if (ids.length === 0 || seers.length !== 1) return null;
  const prefixes = passages.filter((p) => ids.includes(p.id)).map((p) => p.text.slice(0, PREFIX_LENGTH));
  return { role: seers[0].id, prefixes };
}

// 正規化空白後的文字（與畫面、送出的 body 比對用）
export const normalizeText = normalize;
