// 展示模式的劇本（#260 PR 2，docs/design.md「展示模式」的「版面」）：client/scenarios.json 的情境與問題依序是劇本。
// 「已問過」與「目前題目」只記在這個分頁的記憶體（#260 決定 3）：已問過 = 該情境身分的對話中有這題；目前題目 = 最後點的劇本題。
import type { ScenariosFile } from "../client/types";

export interface ScriptItem {
  // 情境 id 與問題 id 組成，劇本中唯一
  key: string;
  // 情境的身分：點這題時先切到這個身分再送出
  role: string;
  text: Readonly<Record<string, string>>;
}

export const scriptKey = (scenarioId: string, questionId: string) => `${scenarioId}/${questionId}`;

// 劇本的題目，照 scenarios.json 的順序攤平（「第 N／M 題」與之後的方向鍵換題都用這個順序）
export function scriptItems(config: ScenariosFile): ScriptItem[] {
  return config.scenarios.flatMap((scenario) =>
    scenario.questions.map((q) => ({ key: scriptKey(scenario.id, q.id), role: scenario.role, text: q.text })),
  );
}

// 「第 N／M 題」：目前題目在劇本中的位置（從 1 起）；還沒點過劇本時 index 為 null
export function scriptPosition(items: readonly ScriptItem[], current: string | null): { index: number | null; total: number } {
  const found = current === null ? -1 : items.findIndex((item) => item.key === current);
  return { index: found === -1 ? null : found + 1, total: items.length };
}

// 已問過：該身分的對話中有這題（以介面語言的題目文字比對；切換語言時目前身分的對話會清掉，#303）
export function wasAsked(conversations: Readonly<Record<string, readonly { question: string }[]>>, role: string, text: string): boolean {
  return (conversations[role] ?? []).some((turn) => turn.question === text);
}

// 點劇本的題目：情境身分不是目前身分時先切換（沿用切換身分的行為，捨棄進行中的提問），身分徽章以 settle 跳一下
export const switchesIdentity = (item: Pick<ScriptItem, "role">, identity: string): boolean => item.role !== identity;

// 題目列的編號（#349，畫板 H-QA）：劇本中的位置（從 1 起），補成兩位數（01、02…）；已問過的題目改標 ✓
export function scriptNumber(items: readonly ScriptItem[], key: string): string {
  return String(items.findIndex((item) => item.key === key) + 1).padStart(2, "0");
}
