// AI 在問你（docs/design.md「AI 開口規則」「AI 發言的外觀」）：待審的接縫（ADR 0011）與問答的接縫提問（ADR 0012）共用。
// 白底、左側 mark 色粗邊、「?」圖示、小標、提問；選項是 44px 的中性按鈕，下方灰字「輪到你」（樣式沿用 #377 的 refusal-ask）。
// 「都不是，我來說明」：說明選填；寫了說明時，人的說明是右側的泡泡，AI 以固定句型複述「我理解成：〈說明〉，對嗎？」（不呼叫模型），
// 確認後才交給 onExplain；沒寫說明就直接記錄（onExplain("")）。說明以文字節點顯示
import { useState, type ReactNode } from "react";
import { fill, strings } from "../client/i18n";

export interface AskOption {
  key: string;
  label: string;
  disabled?: boolean;
  onChoose(): void;
}

interface Props {
  language: string;
  title: string;
  question: ReactNode;
  options: AskOption[];
  // 提問與選項之間的內容（例如名稱的輸入框）
  children?: ReactNode;
  // 有值時多一個「都不是，我來說明」
  onExplain?(note: string): void;
  // 說明的提示（例如記錄後會怎樣）
  explainHint?: string;
  busy?: boolean;
}

// 說明的長度上限（與 review_decisions.note 的 CHECK 相同）
const NOTE_MAX = 500;

export function AskCard({ language, title, question, options, children, onExplain, explainHint, busy = false }: Props) {
  const s = strings(language);
  const [step, setStep] = useState<"ask" | "write" | "confirm">("ask");
  const [note, setNote] = useState("");
  const submit = () => {
    if (note.trim() === "") onExplain?.("");
    else setStep("confirm");
  };
  return (
    <div className="refusal-ask ask-card" role="group" aria-label={title}>
      <span className="refusal-ask__icon" aria-hidden="true">
        ?
      </span>
      <div className="refusal-ask__main">
        <p className="refusal-ask__title">{title}</p>
        <p className="refusal-ask__question">{question}</p>
        {children}
        {step === "ask" && (
          <div className="refusal-ask__options">
            {options.map((o) => (
              <button key={o.key} type="button" disabled={busy || o.disabled} onClick={o.onChoose}>
                {o.label}
              </button>
            ))}
            {onExplain !== undefined && (
              <button type="button" className="refusal-ask__skip" disabled={busy} onClick={() => setStep("write")}>
                {s.commonExplain}
              </button>
            )}
          </div>
        )}
        {step === "write" && (
          <div className="ask-card__explain">
            <p className="refusal-chosen__choice">{s.commonExplain}</p>
            <label>
              {s.commonExplainLabel}
              <textarea value={note} maxLength={NOTE_MAX} rows={3} disabled={busy} onChange={(ev) => setNote(ev.target.value)} />
            </label>
            {explainHint !== undefined && <p className="muted">{explainHint}</p>}
            <div className="refusal-ask__options">
              <button type="button" disabled={busy} onClick={submit}>
                {s.commonExplainSubmit}
              </button>
            </div>
          </div>
        )}
        {step === "confirm" && (
          <div className="ask-card__explain">
            <p className="refusal-chosen__choice">{note.trim()}</p>
            <p className="refusal-ask__question">{fill(s.commonRestate, { note: note.trim() }, language)}</p>
            <div className="refusal-ask__options">
              <button type="button" disabled={busy} onClick={() => onExplain?.(note.trim())}>
                {s.commonRestateYes}
              </button>
              <button type="button" className="refusal-ask__skip" disabled={busy} onClick={() => setStep("write")}>
                {s.commonRestateEdit}
              </button>
            </div>
          </div>
        )}
        <p className="refusal-ask__turn">{s.commonYourTurn}</p>
      </div>
    </div>
  );
}
