// 待審頁的核准計畫（#44）：每筆實體的合併選擇，以及批次核准時要送出的項目。
// 需要選擇合併對象的項目（suggestMerge 的 choose）不能批次核准，只能逐筆決定。
import type { LocalizedText } from "../client/types";
import type { ConflictItem } from "../conflicts/store";
import type { MergeSuggestion } from "../extraction/merge";
import type { EntityApproval, ReviewDocument } from "../extraction/store";

// mergeInto：既有實體的 id；null 表示建立新實體；undefined 表示還沒選擇
export interface EntityChoice {
  mergeInto: string | null | undefined;
  // 核准前修改的名稱（只用於建立新實體）
  names?: LocalizedText;
}

export function initialChoice(suggestion: MergeSuggestion): EntityChoice {
  if (suggestion.mode === "new") return { mergeInto: null };
  if (suggestion.mode === "auto") return { mergeInto: suggestion.target };
  return { mergeInto: undefined };
}

export const canBatch = (suggestion: MergeSuggestion) => suggestion.mode !== "choose";

// 各語言的名稱去掉前後空白後都有值（#47 審查）
export const namesComplete = (names: LocalizedText, languages: readonly string[]) => languages.every((l) => (names[l] ?? "").trim() !== "");

// 修改後的名稱不完整：建立新實體、而且有修改名稱時才檢查（合併時名稱不使用）
export const namesInvalid = (choice: EntityChoice, languages: readonly string[]) =>
  choice.mergeInto === null && choice.names !== undefined && !namesComplete(choice.names, languages);

// 一筆實體的核准內容；還沒選擇合併對象、或修改後的名稱不完整時回 null。送出的名稱去掉前後空白
export function entityApproval(id: string, choice: EntityChoice, languages: readonly string[]): EntityApproval | null {
  if (choice.mergeInto === undefined || namesInvalid(choice, languages)) return null;
  if (choice.mergeInto !== null) return { id, mergeInto: choice.mergeInto };
  if (choice.names === undefined) return { id };
  return { id, names: Object.fromEntries(languages.map((l) => [l, choice.names![l].trim()])) };
}

// 批次核准：只包含待審、可以批次核准的實體，以及兩端都已核准或一起核准的待審關係。
// 名稱不完整的實體略過，回傳略過的筆數（skipped）。
// only 有值時只處理其中的項目（勾選的項目）；沒有值時處理整份文件（「核准這份文件的全部」）
export function batchPlan(
  doc: ReviewDocument,
  suggestions: Record<string, MergeSuggestion>,
  choices: Record<string, EntityChoice>,
  languages: readonly string[],
  only?: ReadonlySet<string>,
): { entities: EntityApproval[]; relations: string[]; skipped: number } {
  const included = (id: string) => only === undefined || only.has(id);
  const candidates = doc.entities.filter((e) => e.status === "pending" && included(e.id) && canBatch(suggestions[e.id] ?? { mode: "new" }));
  const skipped = candidates.filter((e) => namesInvalid(choices[e.id] ?? { mergeInto: null }, languages)).length;
  const entities = candidates
    .map((e) => entityApproval(e.id, choices[e.id] ?? { mergeInto: null }, languages))
    .filter((a): a is EntityApproval => a !== null);
  const approving = new Set(entities.map((e) => e.id));
  const approved = (id: string) => approving.has(id) || doc.entities.some((e) => e.id === id && e.status === "approved");
  const relations = doc.relations.filter((r) => r.status === "pending" && included(r.id) && approved(r.from) && approved(r.to)).map((r) => r.id);
  return { entities, relations, skipped };
}

// 關係是否能核准：兩端都已核准
export const relationReady = (doc: ReviewDocument, relationId: string) => {
  const r = doc.relations.find((x) => x.id === relationId);
  return r !== undefined && [r.from, r.to].every((id) => doc.entities.some((e) => e.id === id && e.status === "approved"));
};

// 待審筆數（#48）：目前身分看得到的待審實體與關係，加上待處理的說法不同（#51）
export const pendingCount = (docs: readonly ReviewDocument[], conflicts: readonly Pick<ConflictItem, "decision">[] = []) =>
  docs.reduce((n, d) => n + [...d.entities, ...d.relations].filter((x) => x.status === "pending").length, 0) +
  conflicts.filter((c) => c.decision === null).length;

// 待審頁的文件清單（#51）：待審的文件，加上只有說法不同、沒有待審實體與關係的文件（以新段落的文件資訊補上）
export function reviewDocuments(docs: readonly ReviewDocument[], conflicts: readonly ConflictItem[]): ReviewDocument[] {
  const out = [...docs];
  for (const c of conflicts) {
    if (out.some((d) => d.id === c.documentId)) continue;
    const p = c.newPassage;
    out.push({ id: c.documentId, title: p.documentTitle, language: p.language, visibility: p.visibility, project: p.project, entities: [], relations: [] });
  }
  return out;
}

// 名稱輸入框的寬度（size，以半形字元計）：隨內容調整，全形字元算 2 個，不截斷長名稱（#48）
export const inputSize = (text: string) => Math.max(8, [...text].reduce((n, c) => n + (c.codePointAt(0)! >= 0x2e80 ? 2 : 1), 0) + 2);

export interface Segment {
  text: string;
  mark: boolean;
}

// 出處段落中標出實體名稱（#48）：依序找出最早出現的名稱（同一位置取最長的），不分大小寫；
// 回傳文字片段，由畫面一律以文字節點與 <mark> 組成（比照 SourcePanel）
export function highlightSegments(text: string, terms: readonly string[]): Segment[] {
  const lower = text.toLowerCase();
  const needles = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t !== ""))];
  const segments: Segment[] = [];
  const push = (part: string, mark: boolean) => part !== "" && segments.push({ text: part, mark });
  let pos = 0;
  for (;;) {
    let start = -1;
    let length = 0;
    for (const n of needles) {
      const i = lower.indexOf(n, pos);
      if (i !== -1 && (start === -1 || i < start || (i === start && n.length > length))) {
        start = i;
        length = n.length;
      }
    }
    if (start === -1) break;
    push(text.slice(pos, start), false);
    push(text.slice(start, start + length), true);
    pos = start + length;
  }
  push(text.slice(pos), false);
  return segments;
}

// 核准或退回後短提示的文字（#48 審查第 2 次）：只有一筆時顯示項目名稱（例如「已核准：鄭書豪」），
// 多筆時顯示筆數（「已核准 N 筆」）。名稱以函式替換，不解讀 $& 這類替換字元；畫面以文字節點顯示
export function toastText(templates: { one: string; many: string }, labels: readonly string[]): string {
  if (labels.length === 1) return templates.one.replace("{name}", () => labels[0]);
  return templates.many.replace("{count}", () => String(labels.length));
}
