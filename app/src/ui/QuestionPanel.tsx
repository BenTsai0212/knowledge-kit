import { clientConfig } from "../client/load";
import { MAX_QUESTION_CHARS } from "../qa/prompt";
import { errorMessage, fill, strings } from "../client/i18n";
import { PRESETS_ID } from "./empty-state";
import { roleScenarios } from "./home";
import { Notice } from "./Notice";
import { questionLength } from "./qa-errors";

interface Props {
  language: string;
  // 資料庫載入完成前、回答串流中不能送出（#195 決定 3：不以新提問中斷前一題）
  disabled: boolean;
  // 輸入框的文字由 App 保存：右側面板的「接著問」填進來（#195）
  text: string;
  onText(text: string): void;
  onAsk(question: string): void;
  // 今天用完了（daily_limit、global_daily_limit，#280）：輸入框上方的常駐說明條，停用輸入框與預設問題；沒有用完時為 null
  limit: string | null;
  // 首頁（#283）：只列情境角色是這個身分的預設問題，名稱改為「常見問題」；省略時列出全部情境
  role?: string;
  // 展示模式（#260）：預設問題由左欄的劇本取代，輸入區只留自由提問
  presets?: boolean;
  // 桌機的首頁（#331，畫板 K-Home）：單行輸入框＋右側「提問」在上、常見問題在下，不顯示「每題獨立回答」的說明
  compact?: boolean;
}

// 輸入框的 id：「縮短問題」按下後把焦點移到這裡
export const QUESTION_INPUT_ID = "question-input";
const HINT_ID = "question-hint";

const roleLabel = (id: string, language: string) => clientConfig.access.roles.find((r) => r.id === id)?.label[language] ?? id;

// 固定在問答頁下方的輸入區（#195）：一行可橫向捲動的預設問題（依情境分組）、自由提問、「每題獨立回答」的說明
export function QuestionPanel({ language, disabled, text, onText, onAsk, limit, role, presets = true, compact = false }: Props) {
  const s = strings(language);
  const scenarios = role === undefined ? clientConfig.scenarios.scenarios : roleScenarios(clientConfig.scenarios, role);
  const off = disabled || limit !== null;
  // 接近 500 字時顯示字數，超過時邊線換 danger、下方說明、停用提問（不送出所以不計次）
  const length = questionLength(text);
  const blocked = off || text.trim() === "" || length.over;
  // 預設問題（首頁是依身分的「常見問題」）：一般在輸入框上方，compact 時在下方
  const presetList = presets && (
    <div id={PRESETS_ID} className="presets" role="group" aria-label={role === undefined ? s.presetQuestions : s.home.commonQuestions}>
      {role !== undefined ? (
        // 首頁：不顯示情境名稱與情境角色（docs/design.md「展示功能的位置」：改成「常見問題」，依身分顯示）
        scenarios.length > 0 && (
          <div className="scenario">
            <span className="muted">{s.home.commonQuestions}</span>
            {scenarios.flatMap((scenario) =>
              scenario.questions.map((q) => (
                <button key={q.id} type="button" disabled={off} onClick={() => onAsk(q.text[language])}>
                  {q.text[language]}
                </button>
              )),
            )}
          </div>
        )
      ) : scenarios.map((scenario) => (
        <div key={scenario.id} className="scenario" role="group" aria-label={scenario.title[language]}>
          <span className="muted">
            {scenario.title[language]} · {s.scenarioRole}
            {s.colon}
            {roleLabel(scenario.role, language)}
          </span>
          {scenario.questions.map((q) => (
            <button key={q.id} type="button" disabled={off} onClick={() => onAsk(q.text[language])}>
              {q.text[language]}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
  return (
    <section className={compact ? "card composer composer--compact" : "card composer"}>
      {limit !== null && (
        <Notice kind="info" icon="◷" title={errorMessage(language, limit)}>
          {s.qaProblems.limitBrowse}
        </Notice>
      )}
      {!compact && presetList}
      <form
        className={compact ? "free-question free-question--compact" : "free-question"}
        onSubmit={(e) => {
          e.preventDefault();
          if (blocked) return;
          onAsk(text);
          onText("");
        }}
      >
        {compact ? (
          <input
            id={QUESTION_INPUT_ID}
            type="text"
            value={text}
            disabled={limit !== null}
            aria-label={s.questionLabel}
            placeholder={s.questionPlaceholder}
            aria-invalid={length.over || undefined}
            aria-describedby={length.show ? HINT_ID : undefined}
            onChange={(e) => onText(e.target.value)}
          />
        ) : (
          <label>
            {s.questionLabel}
            <textarea
              id={QUESTION_INPUT_ID}
              value={text}
              rows={2}
              disabled={limit !== null}
              placeholder={s.questionPlaceholder}
              aria-invalid={length.over || undefined}
              aria-describedby={length.show ? HINT_ID : undefined}
              onChange={(e) => onText(e.target.value)}
            />
          </label>
        )}
        <button type="submit" disabled={blocked}>
          {s.askButton}
        </button>
      </form>
      {length.show && (
        <p id={HINT_ID} className="question-hint" aria-live="polite">
          {length.over && <span>{errorMessage(language, "question_too_long")}</span>}
          <span className={length.over ? "question-count over" : "question-count"}>
            {fill(s.qaProblems.charCount, { count: text.trim().length, max: MAX_QUESTION_CHARS })}
          </span>
        </p>
      )}
      {compact && presetList}
      {!compact && <p className="muted qa-independent">{s.qaIndependent}</p>}
    </section>
  );
}
