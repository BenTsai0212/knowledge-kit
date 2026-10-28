// 合併比對（docs/extraction.md「合併」）：依實體類型的 aliasRules 正規化名稱，與既有實體的 name、names 比對。
// 候選只來自核准者看得到的實體（傳入 readGraph() 的結果）；aliases 不在資料庫中，不比對。
import type { AliasRules, ClientConfig, LocalizedText } from "../client/types";

export function normalizeName(name: string, rules: AliasRules): string {
  let out = name.trim();
  if (rules.normalizeWidth) out = out.normalize("NFKC");
  if (rules.ignoreCase) out = out.toLowerCase();
  if (rules.ignoreWhitespace) out = out.replace(/\s+/gu, "");
  return out;
}

type EntityTypes = ClientConfig["knowledgeModel"]["entityTypes"];

// 一個實體的所有名稱正規化後的集合（同一份文件中的去重也用這個）
export function nameKeys(type: string, names: string[], entityTypes: EntityTypes): Set<string> {
  const rules = entityTypes.find((t) => t.id === type)?.aliasRules;
  if (rules === undefined) return new Set();
  return new Set(names.map((n) => `${type}|${normalizeName(n, rules)}`).filter((k) => !k.endsWith("|")));
}

export type MergeSuggestion =
  // 沒有相符的實體：核准後建立新實體，可以批次核准
  | { mode: "new" }
  // mergeStrategy 為 auto 且剛好一個候選：自動帶入，可以批次核准
  | { mode: "auto"; target: string }
  // review 有候選，或 auto 有多個候選：由核准者逐筆選擇合併對象或建立新實體，不能批次核准
  | { mode: "choose"; candidates: string[] };

export function suggestMerge(
  pending: { type: string; names: LocalizedText },
  visible: { id: string; type: string; name: string; names: LocalizedText }[],
  entityTypes: EntityTypes,
): MergeSuggestion {
  const strategy = entityTypes.find((t) => t.id === pending.type)?.mergeStrategy ?? "review";
  const keys = nameKeys(pending.type, Object.values(pending.names), entityTypes);
  const candidates = visible
    .filter((e) => e.type === pending.type)
    .filter((e) => [...nameKeys(e.type, [e.name, ...Object.values(e.names)], entityTypes)].some((k) => keys.has(k)))
    .map((e) => e.id);
  if (candidates.length === 0) return { mode: "new" };
  if (strategy === "auto" && candidates.length === 1) return { mode: "auto", target: candidates[0] };
  return { mode: "choose", candidates };
}
