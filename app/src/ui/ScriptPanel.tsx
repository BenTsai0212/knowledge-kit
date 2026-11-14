// 展示模式的劇本（#260 PR 2，docs/design.md「展示模式」的「版面」）：問答頁的左欄（440px）。
// 頂部是「劇本」與右側的「第 N／M 題」；每個情境一組，標題旁是情境身分的膠囊（text 底）；問題是 56px 高的按鈕，
// 前面是編號（mono，目前以外已問過的改標 ✓），目前題目用 primary 框線與 primarySoft 底（aria-current）（#349，畫板 H-QA）。
// 一般模式輸入區的預設問題在展示模式由劇本取代（QuestionPanel 的 presets）。
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import { PRESETS_ID } from "./empty-state";
import { scriptItems, scriptKey, scriptNumber, scriptPosition, wasAsked, type ScriptItem } from "./script";

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
      <div className="script__head">
        <h2>{s.presentation.script}</h2>
        <p className="script__position" aria-live="polite">
          {index === null ? fill(s.presentation.scriptTotal, { total }, language) : fill(s.presentation.scriptProgress, { index, total }, language)}
        </p>
      </div>
      <span id={ASKED_ID} hidden>
        {s.presentation.scriptAsked}
      </span>
      <div id={PRESETS_ID} className="script__scenarios">
        {clientConfig.scenarios.scenarios.map((scenario) => (
          <section key={scenario.id} className="script__scenario">
            <h3>
              {scenario.title[language]} <span className="script__role">{roleLabel(scenario.role)}</span>
            </h3>
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
                      {/* 目前的題目一律顯示編號，問過的其他題目才是 ✓（畫板 H-QA） */}
                      <span className={asked && key !== current ? "script__mark script__asked" : "script__mark"} aria-hidden="true">
                        {asked && key !== current ? "✓" : scriptNumber(items, key)}
                      </span>
                      <span>{q.text[language]}</span>
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
