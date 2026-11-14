// 手機與平板的「這次的問題」（#256 決定 1、#333）：問答頁頂部一個「這次的問題（N）」按鈕，按下列出這次問過的問題
// （手機是底部面板，平板是右側的滑出面板），點一題就關閉面板並捲到該題。沒有提問時不顯示；展示模式由 App 不渲染（與桌機的左側清單相同，#260）。
// 桌機在左側導覽（Sidebar 的 session-questions）。
import { useRef, useState } from "react";
import { fill, strings } from "../client/i18n";
import { BottomSheet } from "./BottomSheet";

interface Props {
  language: string;
  questions: readonly { id: string; question: string }[];
  // 捲到該題（與左側導覽相同）
  onQuestion(id: string): void;
  // 面板從哪一側出現：手機是 bottom，平板是 right（#255 的滑出面板）
  side: "bottom" | "right";
}

export function SessionQuestions({ language, questions, onQuestion, side }: Props) {
  const s = strings(language);
  const [open, setOpen] = useState(false);
  // 面板關閉後焦點會回到「這次的問題」按鈕（BottomSheet），所以等關閉之後才捲到選的那一題，避免又被捲回頂部
  const target = useRef<string | null>(null);
  if (questions.length === 0) return null;
  return (
    <>
      <button type="button" className="secondary session-questions-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {fill(s.sessionQuestionsCount, { count: questions.length })}
      </button>
      <BottomSheet
        open={open}
        onClose={() => {
          setOpen(false);
          if (target.current !== null) onQuestion(target.current);
          target.current = null;
        }}
        title={s.sessionQuestions}
        language={language}
        className="session-questions-sheet"
        side={side}
      >
        <ol className="session-questions-list">
          {questions.map((q) => (
            <li key={q.id}>
              <button type="button" onClick={() => ((target.current = q.id), setOpen(false))}>
                {q.question}
              </button>
            </li>
          ))}
        </ol>
      </BottomSheet>
    </>
  );
}
