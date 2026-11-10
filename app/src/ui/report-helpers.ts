// 問答的「回報有錯」（ADR 0007 決定 7，docs/qa.md「回報有錯」）：由一題的結果組成要寫入的回報。
// 回報的可見範圍以送給模型的段落判斷（#209 決定 5），所以 sent 是送出的所有段落（numbering），不只引用的段落
import type { NewReport, ReportCategory } from "../reports/store";
import type { AnswerState } from "./AnswerView";

// 能回報的題目：已經結束、而且是回答或拒答（錯誤訊息不是回答，不能回報）
export const canReport = (state: AnswerState) => state.answer?.kind === "answer" || state.answer?.kind === "refusal";

// 預設的原因：拒答是「資料中有答案，卻拒答了」（#209 決定 4），回答是「內容有誤」
export const defaultCategory = (state: AnswerState): ReportCategory => (state.answer?.kind === "refusal" ? "should_answer" : "wrong_fact");

// 拒答的回報只含問題文字（ADR 0007 決定 5）；回答記錄送出與引用的段落，以及「回答提到」的實體（以送出當下的身分讀出，都看得到）
export function reportOf(state: AnswerState, category: ReportCategory, note: string): NewReport | null {
  const { answer } = state;
  if (answer === undefined || answer.kind === "error") return null;
  return {
    category,
    note,
    question: state.question,
    answer:
      answer.kind === "refusal"
        ? null
        : { text: answer.text, sent: answer.numbering, cited: answer.cited, entities: state.mentions?.entities.map((e) => e.id) ?? [] },
  };
}
