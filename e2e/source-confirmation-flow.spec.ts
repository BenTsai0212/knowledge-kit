// 來源確認的完整流程（ADR 0013，#417 PR 5）：主管在原文面板確認一段 → 一般員工的回答引用這段時，引用標號有標記、原文面板看到
// 「這段原文已確認 · 主管於〈日期〉確認」→ 主管上傳一份與這段說法不同的文件並處理為並存 → 一般員工再問一次：標記消失，
// 原文面板改為「這段原文已確認，但有不同說法」並能打開另一段 → 看不到那段的身分（訪客）看不到任何確認的痕跡。
// 桌機 1440×900、手機 390×844 各走一次（上傳與待審在桌機寬度操作），截圖附在測試報告（CI 的 E2E artifact）。
// /api/ask 一律是假的回應：比對回傳一組說法不同，回答只引用舊的一段。fixture 是中文，只在參考情境執行
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  openApp,
  passSameName,
  s,
  switchIdentity,
  upload,
} from "./support/app";
import {
  access,
  clientName,
  language,
  nonReviewer,
  reviewingUploader,
} from "./support/client";
import { sseBody } from "./support/fake-ask";

// 種子資料「青翼專案進度更新」（內部、青翼專案）的說法與 fixtures/seam-conflict.md 的說法
const OLD_CLAIM = "第三季";
const NEW_CLAIM = "第四季";
const DOC_VISIBILITY = "internal";
const QUESTION = "青翼桌什麼時候上市？";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
// 看不到種子文件的身分（參考情境是訪客）
const outsider = access.roles.find(
  (r) => rank.get(r.visibility)! < rank.get(DOC_VISIBILITY)!,
);

const citationLabel = (n: number) =>
  s.citationConfirmed.replace("{n}", String(n));
const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
}

// xml 中內容含 text 的 <passage number="N"> 的 N
const numberOf = (xml: string, text: string) =>
  [...xml.matchAll(/<passage number="(\d+)"[^>]*>([\s\S]*?)<\/passage>/g)].find(
    (m) => m[2].includes(text),
  )?.[1];
const between = (text: string, start: string, end: string) =>
  text.split(start)[1]?.split(end)[0] ?? "";

// openApp() 之後覆寫：比對時回一組說法不同；回答時只引用舊的一段（[N]，所以第 1 個引用標號就是舊的一段，編號是 N，不一定是 1）。
// 檢索結果沒有舊的一段（看不到的身分）時交給 openApp() 的假回應（引用第 1 段）
async function routeFlow(page: Page): Promise<void> {
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as {
      system?: string;
      messages?: { content: string }[];
    };
    const system = body.system ?? "";
    const user = body.messages?.at(-1)?.content ?? "";
    let text: string | null = null;
    if (system.startsWith("You compare a newly uploaded document")) {
      const fresh = numberOf(
        between(user, "<new_document", "</new_document>"),
        NEW_CLAIM,
      );
      const existing = numberOf(
        between(user, "<existing_passages>", "</existing_passages>"),
        OLD_CLAIM,
      );
      if (fresh !== undefined && existing !== undefined)
        text = JSON.stringify({
          conflicts: [
            {
              new: Number(fresh),
              existing: Number(existing),
              summary: `上市：${OLD_CLAIM} → ${NEW_CLAIM}`,
            },
          ],
        });
    }
    if (system.startsWith("You answer questions")) {
      const old = numberOf(user, OLD_CLAIM);
      if (old !== undefined) text = `青翼桌預計${OLD_CLAIM}上市 [${old}]。`;
    }
    if (text === null) return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: sseBody(text),
    });
  });
}

async function ask(page: Page): Promise<Locator> {
  const input = page.getByPlaceholder(s.questionPlaceholder);
  await input.fill(QUESTION);
  await expect(input).toHaveValue(QUESTION);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  const answer = page.locator("section.answer").last();
  await passSameName(answer);
  await expect(answer.getByText(s.answering)).toHaveCount(0);
  return answer;
}

// 打開回答的第 1 個引用，回傳原文紙面
async function openFirstSource(page: Page, answer: Locator): Promise<Locator> {
  await answer.locator("button.citation").first().click();
  const text = page.locator(".source-text");
  await expect(text.locator(".highlight")).toBeVisible();
  return text;
}

// 關掉原文。手機的原文是原生 <dialog> 的底部面板，退場動畫期間面板外是 inert，等面板收起再往下（citation-confirmation.spec.ts）
async function closeSource(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.source-sheet")).toBeHidden();
}

// 主管上傳、等比對結果出現在待審，處理為並存；寫入後才出現短提示，等它出現再回問答頁（seam-dialogue.spec.ts）
async function uploadAndCoexist(page: Page): Promise<void> {
  await upload(page, { file: "seam-conflict.md", visibility: DOC_VISIBILITY });
  await page
    .getByRole("navigation", { name: s.views })
    .getByRole("button", { name: new RegExp(`^${s.tabReview}`) })
    .click();
  const coexist = page.getByRole("button", {
    name: s.conflictDecisions.coexist,
    exact: true,
  });
  await expect(async () => {
    await page.getByRole("button", { name: s.reviewRefresh }).first().click();
    await expect(coexist).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await coexist.click();
  await expect(page.locator(".toast-region")).toContainText(
    s.conflictToast.replace("{name}", s.conflictDecisions.coexist),
  );
  await page
    .getByRole("navigation", { name: s.views })
    .getByRole("button", { name: new RegExp(`^${s.tabQa}`) })
    .click();
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}：主管確認 → 一般員工看到標記與確認 → 並存後顯示有不同說法；看不到那段的身分沒有痕跡`, async ({
    page,
  }, testInfo) => {
    test.skip(clientName !== "", "fixture 與比對的假回應是參考情境的中文資料");
    test.skip(
      reviewingUploader === undefined || nonReviewer === undefined,
      "需要能上傳也能審查的身分，與不能審查的身分",
    );
    test.skip(outsider === undefined, "access.json 沒有看不到內部文件的身分");
    test.setTimeout(300_000);
    const tag = `${viewport.width}`;
    const manager = reviewingUploader!.label[language];
    const resize = () =>
      page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await routeFlow(page);
    await resize();

    // 1. 主管確認舊的一段
    await switchIdentity(page, reviewingUploader!.id);
    let answer = await ask(page);
    let text = await openFirstSource(page, answer);
    await expect(text.locator(".highlight")).toContainText(OLD_CLAIM);
    await text
      .locator(".highlight + .source-confirm")
      .getByRole("button", { name: s.sourceConfirm, exact: true })
      .click();
    await expect(
      text.locator(".highlight + .source-confirmation"),
    ).toContainText(s.sourceConfirmed);
    await closeSource(page);

    // 2. 一般員工：引用標號有標記；原文面板看到主管的確認（只有角色與日期），沒有按鈕
    await switchIdentity(page, nonReviewer!.id);
    answer = await ask(page);
    const citation = answer.locator("button.citation").first();
    await expect(citation).toHaveClass(/citation--confirmed/);
    // 引用編號依段落編排，不一定是 1：從標號的文字取出 N 再組 aria-label
    const n = Number((await citation.innerText()).trim());
    expect(Number.isInteger(n) && n > 0).toBe(true);
    await expect(citation).toHaveAttribute("aria-label", citationLabel(n));
    await citation.scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, `flow-1-reader-marker-${tag}.png`);
    text = await openFirstSource(page, answer);
    let group = text.getByRole("group", { name: s.sourceConfirmGroup });
    await expect(group).toHaveClass(/source-confirmation--valid/);
    await expect(group).toContainText(s.sourceConfirmed);
    await expect(group).toContainText(manager);
    await expect(group.getByRole("button")).toHaveCount(0);
    await group.scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, `flow-2-reader-confirmed-${tag}.png`);
    await closeSource(page);

    // 3. 主管上傳說法不同的文件並處理為並存（桌機寬度操作）
    await page.setViewportSize({ width: 1440, height: 900 });
    await switchIdentity(page, reviewingUploader!.id);
    await uploadAndCoexist(page);
    await resize();

    // 4. 一般員工再問一次：標記消失；原文面板顯示「有不同說法」並能打開另一段
    await switchIdentity(page, nonReviewer!.id);
    answer = await ask(page);
    await expect(answer.locator("button.citation").first()).toBeVisible();
    await expect(answer.locator(".citation--confirmed")).toHaveCount(0);
    await expect(answer.locator("button.citation").first()).not.toHaveAttribute(
      "aria-label",
      /./,
    );
    text = await openFirstSource(page, answer);
    await expect(text.locator(".highlight")).toContainText(OLD_CLAIM);
    group = text.getByRole("group", { name: s.sourceConfirmGroup });
    await expect(group).toHaveClass(/source-confirmation--disputed/);
    await expect(group).toContainText(s.sourceConfirmedDisputed);
    await expect(group).toContainText(manager);
    await expect(
      group.getByRole("button", { name: s.sourceConfirmRevoke, exact: true }),
    ).toHaveCount(0);
    await group.scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, testInfo, `flow-3-reader-disputed-${tag}.png`);
    await group
      .getByRole("button", { name: s.sourceConfirmOpenOther, exact: true })
      .click();
    await expect(page.locator(".source-text")).toContainText(NEW_CLAIM);
    await screenshot(page, testInfo, `flow-4-other-claim-${tag}.png`);
    await closeSource(page);

    // 5. 看不到那段的身分：回答、引用標號與原文面板都沒有確認的痕跡
    await switchIdentity(page, outsider!.id);
    answer = await ask(page);
    await expect(answer).not.toContainText(OLD_CLAIM);
    await expect(page.locator(".citation--confirmed")).toHaveCount(0);
    await expect(page.locator("button.citation[aria-label]")).toHaveCount(0);
    if ((await answer.locator("button.citation").count()) > 0) {
      text = await openFirstSource(page, answer);
      await expect(text).not.toContainText(OLD_CLAIM);
      await expect(
        page.locator(".source-confirmation, .source-confirm"),
      ).toHaveCount(0);
      await expect(page.getByText(s.sourceConfirmed)).toHaveCount(0);
      await screenshot(page, testInfo, `flow-5-outsider-source-${tag}.png`);
      await closeSource(page);
    }
    await expect(page.getByText(s.sourceConfirmedDisputed)).toHaveCount(0);
    await screenshot(page, testInfo, `flow-5-outsider-answer-${tag}.png`);
  });
}
