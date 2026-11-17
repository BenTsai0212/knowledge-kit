// 說法不同的提問與人的理解（ADR 0012 決定 1、3–6，畫板 S-QA 的 ③～⑧）：上傳 → 比對 → 主管處理為並存 → 問一題同時引用兩段 →
// 提問 → 選和證據不合的假設 → 另一種讀法（先說出證據支持的假設）→ 維持原本的想法 → 記錄。另一個身分作答前，原文欄說明先作答才看得到
// 同事的理解、不透露同事的選擇；作答後回答卡片與原文欄都顯示自己的與同事的理解（角色與日期）。
// 桌機 1440×900、手機 390×844 各走一次（上傳與待審在桌機寬度操作），截圖附在測試報告（CI 的 E2E artifact）。
// /api/ask 一律是假的回應：比對回傳一組（假設與證據取自新段落），回答同時引用兩段。fixture 是中文，只在參考情境執行
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openApp, passSameName, s, switchIdentity, upload } from "./support/app";
import { client, clientName, nonReviewer, reviewingUploader } from "./support/client";
import { sseBody } from "./support/fake-ask";

const dialogue = client.qa?.dialogue === true;
// 種子資料「青翼專案進度更新」的說法與 fixtures/seam-conflict.md 的說法
const OLD_CLAIM = "第三季";
const NEW_CLAIM = "第四季";
const EVIDENCE = "延後至 2026 年第四季";
const HYPOTHESES = ["我覺得是後來改過", "我覺得是不同的情況"];
const QUESTION = "青翼桌什麼時候上市？";

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

// xml 中內容含 text 的 <passage number="N"> 的 N
const numberOf = (xml: string, text: string) => [...xml.matchAll(/<passage number="(\d+)"[^>]*>([\s\S]*?)<\/passage>/g)].find((m) => m[2].includes(text))?.[1];
const between = (text: string, start: string, end: string) => text.split(start)[1]?.split(end)[0] ?? "";

// openApp() 之後覆寫：比對時回一組說法不同，回答時同時引用兩段；其餘交給 openApp() 的假回應
async function routeSeam(page: Page): Promise<void> {
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string; messages?: { content: string }[] };
    const system = body.system ?? "";
    const user = body.messages?.at(-1)?.content ?? "";
    let text: string | null = null;
    if (system.startsWith("You compare a newly uploaded document")) {
      const fresh = numberOf(between(user, "<new_document", "</new_document>"), NEW_CLAIM);
      const existing = numberOf(between(user, "<existing_passages>", "</existing_passages>"), OLD_CLAIM);
      if (fresh !== undefined && existing !== undefined)
        text = JSON.stringify({
          conflicts: [{ new: Number(fresh), existing: Number(existing), summary: `上市：${OLD_CLAIM} → ${NEW_CLAIM}`, hypotheses: HYPOTHESES, evidence: { text: EVIDENCE, supports: 1 } }],
        });
    }
    if (system.startsWith("You answer questions")) {
      const a = numberOf(user, OLD_CLAIM);
      const b = numberOf(user, NEW_CLAIM);
      if (a !== undefined && b !== undefined) text = `青翼桌的上市時間有兩種說法 [${a}][${b}]。`;
    }
    if (text === null) return route.fallback();
    return route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(text) });
  });
}

async function ask(page: Page): Promise<Locator> {
  await page.getByPlaceholder(s.questionPlaceholder).fill(QUESTION);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  const answer = page.locator("section.answer").last();
  await passSameName(answer);
  await expect(answer.locator(".answer__body")).toBeVisible();
  return answer;
}

// 主管上傳、等比對結果出現在待審，處理為並存。並存先播動畫才寫入（exitThenWrite），按鈕消失時還沒寫入；
// 寫入後才出現短提示「已標記：…」，等它出現再離開待審頁
async function uploadAndCoexist(page: Page): Promise<void> {
  await upload(page, { file: "seam-conflict.md", visibility: "internal" });
  await page.getByRole("navigation", { name: s.views }).getByRole("button", { name: new RegExp(`^${s.tabReview}`) }).click();
  const coexist = page.getByRole("button", { name: s.conflictDecisions.coexist, exact: true });
  await expect(async () => {
    await page.getByRole("button", { name: s.reviewRefresh }).first().click();
    await expect(coexist).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await coexist.click();
  await expect(page.locator(".toast-region")).toContainText(s.conflictToast.replace("{name}", s.conflictDecisions.coexist));
  await page.getByRole("navigation", { name: s.views }).getByRole("button", { name: new RegExp(`^${s.tabQa}`) }).click();
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}：提問、另一種讀法、維持原本的想法、記錄；先作答才看得到同事的理解`, async ({ page }, testInfo) => {
    test.skip(clientName !== "", "fixture 與比對的假回應是參考情境的中文資料");
    test.skip(!dialogue, "client.json 的 qa.dialogue 不是 true");
    test.skip(reviewingUploader === undefined || nonReviewer === undefined, "需要能上傳也能審查的身分，與不能審查的身分");
    test.setTimeout(300_000);
    const tag = `${viewport.width}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await routeSeam(page);
    await switchIdentity(page, reviewingUploader!.id);
    await uploadAndCoexist(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    // ③ 提問：假設、都不是與略過；證據不在提問時出現
    let answer = await ask(page);
    const askCard = answer.getByRole("group", { name: s.seamTitle });
    await expect(askCard.getByText(s.dialogueConflictAsk)).toBeVisible();
    for (const h of HYPOTHESES) await expect(askCard.getByRole("button", { name: h, exact: true })).toBeVisible();
    await expect(answer.getByText(EVIDENCE)).toHaveCount(0);
    await askCard.scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, `seam-3-ask-${tag}.png`);

    // ⑤ 選和證據不合的假設：另一種讀法先說出證據支持的假設，再以螢光標出證據
    await askCard.getByRole("button", { name: HYPOTHESES[1], exact: true }).click();
    const alt = answer.getByRole("group", { name: s.dialogueAltTitle });
    await expect(alt).toContainText(`「${HYPOTHESES[0]}」`);
    await expect(alt.locator("mark")).toHaveText(EVIDENCE);
    await alt.scrollIntoViewIfNeeded();
    await screenshot(page, testInfo, `seam-5-alternative-${tag}.png`);

    // ⑥ 維持原本的想法：選項收起，另一種讀法的內文保留；記錄是原本的選擇
    await alt.getByRole("button", { name: s.dialogueAltKeep, exact: true }).click();
    await expect(alt.getByRole("button", { name: s.dialogueAltKeep, exact: true })).toHaveCount(0);
    await expect(alt).toContainText(`「${HYPOTHESES[0]}」`);
    let record = answer.getByRole("group", { name: s.dialogueRecordTitle });
    await expect(record).toContainText(HYPOTHESES[1]);
    await expect(record.getByText(s.dialogueRecordPeers)).toHaveCount(0);
    await record.scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, `seam-6-keep-record-${tag}.png`);

    // 另一個身分：作答前，原文欄說明先作答才看得到同事的理解，不透露同事的選擇
    await switchIdentity(page, nonReviewer!.id);
    answer = await ask(page);
    await expect(answer.getByRole("group", { name: s.seamTitle })).toBeVisible();
    await answer.locator("button.citation").first().click();
    await expect(page.getByText(s.dialogueRecordLocked).first()).toBeVisible();
    await expect(page.locator(".source-text").getByRole("group", { name: s.dialogueRecordTitle })).toHaveCount(0);
    await screenshot(page, testInfo, `seam-source-locked-${tag}.png`);
    await page.keyboard.press("Escape");

    // 選證據支持的假設：補一句證據；記錄有自己的與同事（主管）的理解，只顯示角色與日期
    await answer.getByRole("group", { name: s.seamTitle }).getByRole("button", { name: HYPOTHESES[0], exact: true }).click();
    await expect(answer.locator(".seam-add")).toContainText(EVIDENCE);
    record = answer.getByRole("group", { name: s.dialogueRecordTitle });
    await expect(record).toContainText(HYPOTHESES[0]);
    await expect(record.getByText(s.dialogueRecordPeers)).toBeVisible();
    await expect(record).toContainText(HYPOTHESES[1]);
    await expect(record).toContainText(reviewingUploader!.label[client.defaultLanguage]);
    await record.scrollIntoViewIfNeeded();
    await screenshot(page, testInfo, `seam-4-evidence-peers-${tag}.png`);

    // 原文欄：並存段落的下方附同一份記錄，小標與回答卡片相同（畫板 S-Spec 的「記錄」，#400）
    await answer.locator("button.citation").first().click();
    const sourceRecord = page.locator(".source-text").getByRole("group", { name: s.dialogueRecordTitle }).first();
    await expect(sourceRecord.locator(".seam-record__label").first()).toHaveText(s.dialogueRecordTitle);
    await expect(sourceRecord).toContainText(HYPOTHESES[0]);
    await expect(sourceRecord).toContainText(HYPOTHESES[1]);
    await expect(page.getByText(s.dialogueRecordLocked)).toHaveCount(0);
    await sourceRecord.scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, `seam-source-record-${tag}.png`);
  });
}
