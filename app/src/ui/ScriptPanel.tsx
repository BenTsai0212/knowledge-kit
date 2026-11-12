// 展示模式的劇本（#260 PR 2，docs/design.md「展示模式」的「版面」）：問答頁的左欄（440px）。
// 每個情境一組，標題旁是情境的身分徽章；問題是 56px 高的按鈕，目前題目用 primary 框線與淡底（aria-current），已問過的標 ✓；上方「第 N／M 題」。
// 一般模式輸入區的預設問題在展示模式由劇本取代（QuestionPanel 的 presets）。
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import { PRESETS_ID } from "./empty-state";
import { scriptItems, scriptKey, scriptPosition, wasAsked, type ScriptItem } from "./script";

interface Props {
  language: string;
  // 各身分的對話（#303）：已問過 ✓ 依情境身分的對話判斷
  conversations: Readonly<Record<string, readonly { question: string }[]>>;
  current: string | null;
  disabled: boolean;
  onAsk(item: ScriptItem): void;
}

const ASKED_ID = "script-asked";
const items = scriptItems(clientConfig.scenarios);

export function ScriptPanel({ language, conversations, current, disabled, onAsk }: Props) {
  const s = strings(language);
  const { index, total } = scriptPosition(items, current);
  const roleLabel = (id: string) => clientConfig.access.roles.find((r) => r.id === id)?.label[language] ?? id;
  return (
    <nav className="script" aria-label={s.presentation.script}>
      <p className="script__position" aria-live="polite">
        {index === null ? fill(s.presentation.scriptTotal, { total }, language) : fill(s.presentation.scriptProgress, { index, total }, language)}
      </p>
      <span id={ASKED_ID} hidden>
        {s.presentation.scriptAsked}
      </span>
      <div id={PRESETS_ID} className="script__scenarios">
        {clientConfig.scenarios.scenarios.map((scenario) => (
          <section key={scenario.id} className="script__scenario">
            <h2>
              {scenario.title[language]} <span className="badge script__role">{roleLabel(scenario.role)}</span>
            </h2>
            <ol>
              {scenario.questions.map((q) => {
                const key = scriptKey(scenario.id, q.id);
                const asked = wasAsked(conversations, scenario.role, q.text[language]);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-current={key === current ? "step" : undefined}
                      aria-describedby={asked ? ASKED_ID : undefined}
                      onClick={() => onAsk({ key, role: scenario.role, text: q.text })}
                    >
                      <span>{q.text[language]}</span>
                      {asked && <span className="script__asked" aria-hidden="true">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </nav>
  );
}
