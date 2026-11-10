// 「回答提到」與右側的實體面板（#195，docs/qa.md「回答提到」）。/api/ask 一律是假的回應：
// 問答的回答寫出資料集中所有實體的名稱（包括該身分看不到的），並引用 prompt 中的每一段，所以列出哪些實體只由權限與引用段落決定。
import { expect, test, type Page } from "@playwright/test";
import { language, openApp, s, switchIdentity, tab, type RoleId } from "./support/app";
import { access, reviewer } from "./support/client";
import { allEntityNames, entityNames } from "./support/dataset";
import { MAX_QUESTION_CHARS } from "../app/src/qa/prompt";

const roles = access.roles.map((r) => r.id);
// 看得最多的身分（參考情境是 manager）；比較的身分是看不到的實體名稱最多的另一個身分
const viewer = reviewer?.id ?? roles[0];
const other = roles
  .filter((id) => id !== viewer)
  .map((id) => ({ id, hidden: entityNames(id, language).hidden }))
  .sort((a, b) => b.hidden.length - a.hidden.length)[0];

// 問答的請求：回答是所有實體的名稱加上 prompt 中每一段的引用；其他請求交給 openApp() 註冊的假 /api/ask
async function routeNamingAnswer(page: Page): Promise<void> {
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string; messages?: { content: string }[] };
    if (!(body.system ?? "").startsWith("You answer questions")) return route.fallback();
    const count = (body.messages?.[0]?.content.match(/<passage number="/g) ?? []).length;
    const citations = Array.from({ length: count }, (_, i) => `[${i + 1}]`).join("");
    const text = `${allEntityNames(language).join(" / ")} ${citations}`;
    const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: event("delta", { text }) + event("done", { stopReason: "end_turn" }),
    });
  });
}

// 以 names 中的名稱組成問題（不超過問題的字數上限），讓檢索找到提到這些實體的段落
const questionOf = (names: string[]) => {
  let question = "";
  for (const name of names) if (`${question} ${name}`.trim().length <= MAX_QUESTION_CHARS) question = `${question} ${name}`.trim();
  return question;
};

// 以目前的身分提問，等回答（含回答提到）結束，回傳列出的實體按鈕文字
async function ask(page: Page, question: string): Promise<string[]> {
  await page.getByPlaceholder(s.questionPlaceholder).fill(question);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  const answer = page.locator("section.answer").last();
  await expect(answer.getByRole("heading", { name: question })).toBeVisible();
  await expect(answer.getByText(s.answering)).toHaveCount(0);
  return answer.getByRole("group", { name: s.answerMentions }).getByRole("button").allInnerTexts();
}

// 按鈕文字是顯示名稱；同名的實體另加括號說明，所以比對開頭
const isOneOf = (text: string, names: string[]) => names.some((name) => text === name || text.startsWith(name));

test("點「回答提到」的實體：右側面板顯示實體、鄰近圖、關係與接著問；在圖譜中查看", async ({ page }) => {
  const { visible, connected } = entityNames(viewer, language);
  await openApp(page);
  await routeNamingAnswer(page);
  await switchIdentity(page, viewer);
  const listed = await ask(page, questionOf(connected));
  expect(listed.length).toBeGreaterThan(0);
  expect(listed.filter((text) => !isOneOf(text, visible))).toEqual([]);

  const target = listed.find((text) => connected.includes(text));
  expect(target, "列出的實體中沒有名稱不重複、而且有關係的實體").toBeDefined();
  await page.getByRole("group", { name: s.answerMentions }).getByRole("button", { name: target!, exact: true }).click();
  const panel = page.getByRole("complementary", { name: target!, exact: true });
  await expect(panel.getByRole("heading", { level: 2 })).toContainText(target!);
  await expect(panel.locator(".graph-canvas.compact canvas").first()).toBeVisible();

  // 關係清單：點相關實體，面板改以它為中心
  const related = panel.getByRole("list").first().getByRole("button").first();
  const center = await related.innerText();
  await related.click();
  const next = page.getByRole("complementary", { name: center, exact: true });
  await expect(next.getByRole("heading", { level: 2 })).toContainText(center);

  // 接著問：填進輸入框，不直接送出
  const followUp = next.locator(".follow-ups button").first();
  const question = await followUp.innerText();
  expect(question).toContain(center);
  await followUp.click();
  await expect(page.getByPlaceholder(s.questionPlaceholder)).toHaveValue(question);
  await expect(page.locator("section.answer")).toHaveCount(1);

  // 在圖譜中查看：切到圖譜頁並選取該實體
  await next.getByRole("button", { name: s.viewInGraph }).click();
  await expect(tab(page, s.tabGraph)).toHaveAttribute("aria-current", "page");
  await expect(page.locator("section.entity").getByRole("heading", { level: 2 })).toContainText(center);
});

test("「回答提到」只列出目前身分看得到的實體，依身分不同", async ({ page }) => {
  test.skip(other === undefined || other.hidden.length === 0, `資料集中沒有 ${viewer} 看得到、其他身分看不到的實體`);
  const role: RoleId = other!.id;
  const { visible: roleVisible, connected: roleConnected } = entityNames(role, language);
  // 同一題：看不到的實體名稱在前，加上該身分看得到的名稱（讓兩個身分都檢索得到段落）
  const question = questionOf([...other!.hidden, ...roleConnected]);
  await openApp(page);
  await routeNamingAnswer(page);

  await switchIdentity(page, viewer);
  const byViewer = await ask(page, question);
  expect(byViewer.filter((text) => isOneOf(text, other!.hidden)), `${viewer} 列出 ${role} 看不到的實體`).not.toEqual([]);

  await switchIdentity(page, role);
  await expect(page.locator("section.answer")).toHaveCount(0);
  const byRole = await ask(page, question);
  expect(byRole.filter((text) => !isOneOf(text, roleVisible))).toEqual([]);
  expect(byRole).not.toEqual(byViewer);
});
