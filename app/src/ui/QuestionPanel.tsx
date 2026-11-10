import { clientConfig } from "../client/load";
import { MAX_QUESTION_CHARS } from "../qa/prompt";
import { strings } from "../client/i18n";

interface Props {
  language: string;
  // 資料庫載入完成前、回答串流中不能送出（#195 決定 3：不以新提問中斷前一題）
  disabled: boolean;
  // 輸入框的文字由 App 保存：右側面板的「接著問」填進來（#195）
  text: string;
  onText(text: string): void;
  onAsk(question: string): void;
}

const roleLabel = (id: string, language: string) => clientConfig.access.roles.find((r) => r.id === id)?.label[language] ?? id;

// 固定在問答頁下方的輸入區（#195）：一行可橫向捲動的預設問題（依情境分組）、自由提問、「每題獨立回答」的說明
export function QuestionPanel({ language, disabled, text, onText, onAsk }: Props) {
  const s = strings(language);
  return (
    <section className="card composer">
      <div className="presets" role="group" aria-label={s.presetQuestions}>
        {clientConfig.scenarios.scenarios.map((scenario) => (
          <div key={scenario.id} className="scenario" role="group" aria-label={scenario.title[language]}>
            <span className="muted">
              {scenario.title[language]} · {s.scenarioRole}
              {s.colon}
              {roleLabel(scenario.role, language)}
            </span>
            {scenario.questions.map((q) => (
              <button key={q.id} type="button" disabled={disabled} onClick={() => onAsk(q.text[language])}>
                {q.text[language]}
              </button>
            ))}
          </div>
        ))}
      </div>
      <form
        className="free-question"
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled || text.trim() === "") return;
          onAsk(text);
          onText("");
        }}
      >
        <label>
          {s.questionLabel}
          <textarea
            value={text}
            maxLength={MAX_QUESTION_CHARS}
            rows={2}
            placeholder={s.questionPlaceholder}
            onChange={(e) => onText(e.target.value)}
          />
        </label>
        <button type="submit" disabled={disabled || text.trim() === ""}>
          {s.askButton}
        </button>
      </form>
      <p className="muted qa-independent">{s.qaIndependent}</p>
    </section>
  );
}
