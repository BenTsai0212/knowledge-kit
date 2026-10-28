import { useState } from "react";
import { clientConfig } from "../client/load";
import { MAX_QUESTION_CHARS } from "../qa/prompt";
import { strings } from "./strings";

interface Props {
  language: string;
  disabled: boolean;
  onAsk(question: string): void;
}

const roleLabel = (id: string, language: string) => clientConfig.access.roles.find((r) => r.id === id)?.label[language] ?? id;

export function QuestionPanel({ language, disabled, onAsk }: Props) {
  const s = strings(language);
  const [text, setText] = useState("");
  return (
    <section className="card">
      <h2>{s.presetQuestions}</h2>
      {clientConfig.scenarios.scenarios.map((scenario) => (
        <div key={scenario.id} className="scenario">
          <h3>
            {scenario.title[language]}
            <span className="muted">
              {" "}
              · {s.scenarioRole}
              {s.colon}
              {roleLabel(scenario.role, language)}
            </span>
          </h3>
          <div className="questions">
            {scenario.questions.map((q) => (
              <button key={q.id} type="button" disabled={disabled} onClick={() => onAsk(q.text[language])}>
                {q.text[language]}
              </button>
            ))}
          </div>
        </div>
      ))}
      <form
        className="free-question"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== "") onAsk(text);
        }}
      >
        <label>
          {s.questionLabel}
          <textarea
            value={text}
            maxLength={MAX_QUESTION_CHARS}
            rows={2}
            placeholder={s.questionPlaceholder}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button type="submit" disabled={disabled || text.trim() === ""}>
          {s.askButton}
        </button>
      </form>
    </section>
  );
}
