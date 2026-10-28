// 解析並驗證模型的輸出（docs/extraction.md「驗證」）。格式錯誤時拋出 ExtractionFormatError（該批記為失敗，可以重試）；
// 不符合規則的項目捨棄並依原因計數。
import type { ClientConfig, LanguageCode, LocalizedText } from "../client/types";

export type DropReason =
  | "no_sources" // 沒有出處，或出處都不是這一批的段落編號
  | "unknown_type" // 類型不存在於 knowledge-model.json
  | "bad_names" // 缺少某種語言的名稱，或名稱為空
  | "bad_endpoint" // 關係的兩端不是本批中保留的實體
  | "type_mismatch" // 關係兩端的類型不符合關係類型的 from／to
  | "duplicate_key"; // 同一批中重複的實體 key

export interface ParsedEntity {
  key: string;
  type: string;
  names: LocalizedText;
  // 段落 id
  sources: string[];
}

export interface ParsedRelation {
  type: string;
  from: string;
  to: string;
  sources: string[];
}

export interface ParsedBatch {
  entities: ParsedEntity[];
  relations: ParsedRelation[];
  dropped: Partial<Record<DropReason, number>>;
}

export class ExtractionFormatError extends Error {
  constructor() {
    super("模型輸出的格式不符");
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 開頭與結尾的 ``` 或 ```json 先去掉
function stripFence(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return m ? m[1] : text.trim();
}

export function parseExtraction(
  text: string,
  numbering: string[],
  model: ClientConfig["knowledgeModel"],
  languages: LanguageCode[],
): ParsedBatch {
  let value: unknown;
  try {
    value = JSON.parse(stripFence(text));
  } catch {
    throw new ExtractionFormatError();
  }
  if (!isObject(value) || !Array.isArray(value.entities) || !Array.isArray(value.relations)) throw new ExtractionFormatError();

  const dropped: ParsedBatch["dropped"] = {};
  const drop = (reason: DropReason) => (dropped[reason] = (dropped[reason] ?? 0) + 1);
  // 出處：只保留這一批的段落編號，轉成段落 id；一個都不剩時整筆捨棄
  const sourcesOf = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= numbering.length).map((n) => numbering[n - 1]))] : [];
  const entityTypes = new Set(model.entityTypes.map((t) => t.id));

  const entities: ParsedEntity[] = [];
  for (const e of value.entities) {
    if (!isObject(e) || typeof e.key !== "string" || typeof e.type !== "string" || !isObject(e.names)) throw new ExtractionFormatError();
    if (entities.some((x) => x.key === e.key)) {
      drop("duplicate_key");
      continue;
    }
    if (!entityTypes.has(e.type)) {
      drop("unknown_type");
      continue;
    }
    const raw = e.names;
    const names = Object.fromEntries(languages.map((l) => [l, typeof raw[l] === "string" ? (raw[l] as string).trim() : ""]));
    if (Object.values(names).some((n) => n === "")) {
      drop("bad_names");
      continue;
    }
    const sources = sourcesOf(e.sources);
    if (sources.length === 0) {
      drop("no_sources");
      continue;
    }
    entities.push({ key: e.key, type: e.type, names, sources });
  }

  const typeOf = new Map(entities.map((e) => [e.key, e.type]));
  const relations: ParsedRelation[] = [];
  for (const r of value.relations) {
    if (!isObject(r) || typeof r.type !== "string" || typeof r.from !== "string" || typeof r.to !== "string") throw new ExtractionFormatError();
    const definition = model.relationTypes.find((t) => t.id === r.type);
    if (definition === undefined) {
      drop("unknown_type");
      continue;
    }
    // 依附於被捨棄（或不存在）的實體的關係一併捨棄
    const from = typeOf.get(r.from);
    const to = typeOf.get(r.to);
    if (from === undefined || to === undefined) {
      drop("bad_endpoint");
      continue;
    }
    if (!definition.from.includes(from) || !definition.to.includes(to)) {
      drop("type_mismatch");
      continue;
    }
    const sources = sourcesOf(r.sources);
    if (sources.length === 0) {
      drop("no_sources");
      continue;
    }
    relations.push({ type: r.type, from: r.from, to: r.to, sources });
  }
  return { entities, relations, dropped };
}
