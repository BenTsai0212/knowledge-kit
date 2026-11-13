// 引用每一段的假回答（手機 #256 與桌機 #335 的原文面板共用）。/api/ask 一律是假的回應。
import { expect, type Locator, type Page } from "@playwright/test";
import { presetQuestions, s, switchIdentity } from "./app";
import { FAKE_ANSWER_LEAD, sseBody } from "./fake-ask";

const answers = (page: Page) => page.locator("section.answer");

// 問答的回答依序引用 prompt 中的每一段（[1][2]…[k]），所以引用標號的數量等於檢索到的段落數；
// prompt 中每段只出現一次（app/src/qa/prompt.ts 的 groups()），「出處 N／M」的 M 就是 k。其他請求交給 openApp() 的假回應。
// 回傳一個函式：取得最近一次問答請求的段落數
async function routeCitingAnswer(page: Page): Promise<() => number> {
  let passages = 0;
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string; messages?: { content: string }[] };
    if (!(body.system ?? "").startsWith("You answer questions")) return route.fallback();
    passages = (body.messages?.[0]?.content.match(/<passage number="/g) ?? []).length;
    const citations = Array.from({ length: passages }, (_, i) => `[${i + 1}]`).join("");
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(`${FAKE_ANSWER_LEAD} ${citations}。`) });
  });
  return () => passages;
}

// 不假設某一題一定檢索到 2 段（各客戶的資料與身分不同）：依序以預設問題的身分提問，
// 找到檢索到至少 2 個不同段落的那一題；回傳該題的回答與段落數，三份資料都可能找不到時回 null
export async function askWithSeveralSources(page: Page): Promise<{ answer: Locator; total: number } | null> {
  const passages = await routeCitingAnswer(page);
  for (const question of presetQuestions) {
    await switchIdentity(page, question.role);
    await page.getByPlaceholder(s.questionPlaceholder).fill(question.text);
    await page.getByRole("button", { name: s.askButton, exact: true }).click();
    const answer = answers(page).last();
    await expect(answer.getByRole("heading", { name: question.text })).toBeVisible();
    await expect(answer.getByText(s.answering)).toHaveCount(0);
    const total = passages();
    if (total < 2) continue;
    await expect(answer).toContainText(FAKE_ANSWER_LEAD);
    await expect(answer.locator("button.citation")).toHaveCount(total);
    return { answer, total };
  }
  return null;
}
