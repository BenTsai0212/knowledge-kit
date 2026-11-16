// 接縫的提問與選項文字（ADR 0011 決定 8，docs/design.md「待審的接縫」）：待審頁（審核者）與首頁「有更新」的
// 請上傳者確認（上傳者，ADR 0011 決定 6）共用。名稱與選項只用目前身分看得到的實體（graph）
import { fill, type strings } from "../client/i18n";
import type { RequestChoice, RequestReply } from "../extraction/requests";
import type { Unsure } from "../extraction/seams";
import type { Graph } from "../graph/read";
import { entityOptionLabel } from "./graph-labels";
import type { EntitySeam, SeamOption } from "./seam-review";

type Strings = ReturnType<typeof strings>;

// 實體接縫的提問；name：文件語言的名稱
export function seamQuestion(s: Strings, seam: EntitySeam, name: string, language: string): string {
  const { ask } = seam;
  if (ask.kind === "candidates") return fill(s.seamAskCandidates, { count: ask.candidates.length, name }, language);
  if (ask.kind === "near") return fill(ask.target === null ? s.seamAskNearDocument : s.seamAskNear, { name, other: ask.other }, language);
  if (ask.kind === "unsure") return unsureQuestion(s, ask.unsure === "relation_wording" ? "other" : ask.unsure, name, language);
  const names = new Intl.DisplayNames([language], { type: "language" });
  return fill(s.seamAskMissing, { name, languages: ask.languages.map((l) => names.of(l) ?? l).join(s.listSeparator) }, language);
}

// 模型標示沒把握的提問（關係的接縫也用）
export function unsureQuestion(s: Strings, unsure: Unsure, name: string, language: string): string {
  const text = { same_name: s.seamAskSameName, possible_typo: s.seamAskTypo, relation_wording: s.seamAskWording, other: s.seamAskOther };
  return fill(text[unsure], { name }, language);
}

// 關係接縫的提問：只分「說法不明確」與其他
export const relationQuestion = (s: Strings, unsure: Unsure, name: string, language: string) =>
  unsureQuestion(s, unsure === "relation_wording" ? unsure : "other", name, language);

// 選項的文字；seam 省略時是關係的接縫
export function seamOptionLabel(s: Strings, o: SeamOption, graph: Graph, language: string, seam?: EntitySeam): string {
  if (o.kind === "reject") return s.seamOptionExclude;
  if (o.kind === "keep") return seam?.ask.kind === "missing" ? s.seamOptionFilled : s.seamOptionKeep;
  if (o.kind === "new") return seam?.ask.kind === "near" ? s.seamOptionDifferent : s.seamOptionNew;
  if (seam?.ask.kind === "near") return s.seamOptionSame;
  const target = graph.entities.find((x) => x.id === o.target);
  return target ? entityOptionLabel(graph, target, language) : o.target;
}

// 上傳者選的選項 → 回答（「都不是，我來說明」另由 AskCard 的 onExplain 寫入 other）
export const replyOf = (o: SeamOption): RequestReply => (o.kind === "merge" ? { choice: "merge", mergeInto: o.target } : { choice: o.kind });

// 上傳者的選項與回答的文字（上傳者首頁與審核者的待審頁）：與審核者的選項相同，合併對象以目前身分看得到的名稱顯示；
// other 是「都不是，我來說明」。上傳者不能補名稱，名稱缺少語言時「照系統的判斷收錄」是「我覺得沒問題」
export function replyLabel(s: Strings, choice: RequestChoice, mergeInto: string | null, graph: Graph, language: string, seam?: EntitySeam): string {
  if (choice === "other") return s.commonExplain;
  const option: SeamOption = choice === "merge" ? { kind: "merge", target: mergeInto ?? "" } : { kind: choice };
  return seamOptionLabel(s, option, graph, language, seam?.ask.kind === "missing" ? undefined : seam);
}
