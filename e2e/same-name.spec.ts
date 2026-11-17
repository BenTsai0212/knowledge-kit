// 同名的反問（ADR 0012 決定 1，畫板 S-QA）：問題提到目前身分看得到的同名實體時，先反問、不呼叫模型；選了之後才送出，
// 問題泡泡保留原問題，下方灰字是補上的說明，送出的問題中名稱換成選項。「都想知道」照原問題送出。
// client.json 的 qa.dialogue 為 false 時與現行相同（直接回答）。桌機 1440×900、手機 390×844 各走一次，截圖附在測試報告。/api/ask 一律是假的回應
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { escapeText } from "../app/src/qa/prompt";
import { openApp, s, sameNameCard, switchIdentity } from "./support/app";
import { access, client, language } from "./support/client";
import { sameNameEntities } from "./support/dataset";
import { FAKE_ANSWER_LEAD, sseBody } from "./support/fake-ask";

const dialogue = client.qa?.dialogue === true;
// 看得到同名實體的第一個身分（參考情境是 staff 的兩位林志明）
const twins = access.roles.map((r) => ({ role: r.id, group: sameNameEntities(r.id, language)[0] })).find((x) => x.group !== undefined);
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (el: Locator) => (await el.boundingBox())!;
// 單複數寫法中 =2 的那一個（同名的剛好兩個時的文字）
const pickTwo = (template: string) => template.replace(/\{count, plural,\s*=2 \{([^{}]*)\}(?:\s*[=\w]+ \{[^{}]*\})*\s*\}/, "$1");

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

// 問答的請求：記下送出的問題（<question> 的內容，已跳脫，所以比對時以 escapeText() 轉換），回假的回答
async function setUp(page: Page, role: string): Promise<string[]> {
  const sent: string[] = [];
  await openApp(page);
  await switchIdentity(page, role);
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string; messages?: { content: string }[] };
    if (!(body.system ?? "").startsWith("You answer questions")) return route.fallback();
    const user = body.messages?.at(-1)?.content ?? "";
    sent.push(/<question>\n([\s\S]*)\n<\/question>/.exec(user)?.[1] ?? "");
    return route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(`${FAKE_ANSWER_LEAD}[1]`) });
  });
  return sent;
}

async function ask(page: Page, question: string): Promise<Locator> {
  await page.getByPlaceholder(s.questionPlaceholder).fill(question);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  return page.locator("section.answer").last();
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("同名：回答前反問，選了之後才送出；都想知道照原問題送出（qa.dialogue 關閉時直接回答）", async ({ page }, testInfo) => {
      test.skip(twins === undefined, "沒有身分看得到兩個以上同名的實體");
      const { role, group } = twins!;
      const question = group.name;
      const sent = await setUp(page, role);

      let turn = await ask(page, question);
      if (!dialogue) {
        // 查詢版：與現行相同，沒有反問，直接以原問題回答
        await expect(turn.getByText(FAKE_ANSWER_LEAD)).toBeVisible();
        await expect(sameNameCard(page)).toHaveCount(0);
        expect(sent).toEqual([escapeText(question)]);
        return;
      }

      // 反問：小標、提問（含名稱）、每個看得到的同名實體一個選項＋「都想知道」、「輪到你」；還沒有呼叫模型
      const card = sameNameCard(turn);
      await expect(card).toBeVisible();
      await expect(card.locator(".refusal-ask__question")).toContainText(group.name);
      // 量詞依類型（#400，畫板 S-QA）：人是「想確認你問的是誰」「兩位」「哪一位」，其他類型是「兩個」「哪一個」
      const [title, askText, both] = group.person
        ? [s.dialogueSameNameTitlePerson, s.dialogueSameNameAskPerson, s.dialogueSameNameBothPerson]
        : [s.dialogueSameNameTitle, s.dialogueSameNameAsk, s.dialogueSameNameBoth];
      await expect(card).toHaveAttribute("aria-label", title);
      const options = card.getByRole("button");
      await expect(options).toHaveCount(group.ids.length + 1);
      if (group.ids.length === 2) {
        await expect(card.locator(".refusal-ask__question")).toHaveText(pickTwo(askText).replace("{name}", group.name));
        await expect(options.last()).toHaveText(pickTwo(both));
      }
      for (const option of (await options.all()).slice(0, -1)) await expect(option).toContainText(group.name);
      await expect(card.getByText(s.commonYourTurn)).toBeVisible();
      await expect(turn.locator("h2")).toHaveText(question);
      for (const button of await options.all()) expect((await box(button)).height).toBeGreaterThanOrEqual(44);
      expect(sent).toEqual([]);
      expect(await noHorizontalScroll(page)).toBe(true);
      await screenshot(page, testInfo, `same-name-${viewport.name}-ask`);

      // 選第一位：同一題接著回答；泡泡保留原問題，下方灰字是選項，送出的問題中名稱換成選項
      const label = (await options.first().textContent())!;
      await options.first().click();
      await expect(turn.getByText(FAKE_ANSWER_LEAD)).toBeVisible();
      await expect(sameNameCard(turn)).toHaveCount(0);
      await expect(turn.locator("h2")).toHaveText(question);
      await expect(turn.locator(".answer__note")).toContainText(label);
      expect(sent).toEqual([escapeText(label)]);
      expect(await noHorizontalScroll(page)).toBe(true);
      await screenshot(page, testInfo, `same-name-${viewport.name}-chosen`);

      // 再問一次、選「都想知道」：照原問題送出，沒有灰字
      turn = await ask(page, question);
      await sameNameCard(turn).getByRole("button").last().click();
      await expect(turn.getByText(FAKE_ANSWER_LEAD)).toBeVisible();
      await expect(turn.locator(".answer__note")).toHaveCount(0);
      expect(sent).toEqual([escapeText(label), escapeText(question)]);
    });
  });
}
