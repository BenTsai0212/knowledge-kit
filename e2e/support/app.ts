// 端對端測試共用的操作（#66）。畫面文字一律從選定客戶的 i18n 讀取，測試中不寫死；只用預設語言（client.json 的 defaultLanguage）。
import { expect, type Locator, type Page } from "@playwright/test";
import { access, language, s, scenarios } from "./client";
import { FAKE_ENTITY_NAME, routeFakeAsk } from "./fake-ask";
import { demoAccount } from "../../app/src/ui/sign-in";

export { language, s };

// 邀請碼：假的 /api/ask 不檢查，任意虛構字串即可（只存在 sessionStorage）
export const ACCESS_CODE = "e2e-access-code";

export type RoleId = string;

// 預設問題（scenarios.json）；資料庫載入完成前停用
export const presetQuestions = scenarios.scenarios.flatMap((x) => x.questions.map((q) => ({ role: x.role as RoleId, text: q.text[language] })));

// 擋下語意模型的下載（模型檔的網址見 app/src/retrieval/semantic/model-files.ts）：CI 不下載模型，
// 選用語意向量的客戶降級到 keyword-hash（#175，docs/testing.md「客戶」）；keyword-hash 的客戶不會發出這類請求。須在 page.goto 之前呼叫
export async function blockModelDownload(page: Page): Promise<void> {
  await page.route("https://huggingface.co/**", (route) => route.abort());
}

// 開啟評測台的網址（#192，docs/evals.md「開啟評測台」）：沒有這個參數時，canReview 的身分也看不到評測台
export const EVALS_PATH = "/?tools=evals";

// 展示模式（?mode=presentation）的登入頁只有邀請碼（#287 決定 2）
export const isPresentation = (path: string) => new URL(path, "http://localhost").searchParams.get("mode") === "presentation";

// 打開網站（path 可帶網址參數，例如展示模式的 /?mode=presentation）、以「使用邀請碼體驗」輸入邀請碼（可以切換身分，#287），
// 切到問答頁（登入後的預設頁是首頁，#283；展示模式直接進問答），等資料庫載入完成（預設問題的按鈕可以按）。帳號登入見 sign-in.spec.ts
export async function openApp(page: Page, path = "/"): Promise<void> {
  await blockModelDownload(page);
  await routeFakeAsk(page);
  await page.goto(path);
  if (!isPresentation(path)) await page.getByRole("button", { name: s.signInWithCode }).click();
  await page.getByLabel(s.accessCodeLabel).fill(ACCESS_CODE);
  await page.getByRole("button", { name: s.accessCodeSubmit }).click();
  if (!isPresentation(path)) await openTab(page, s.tabQa);
  await expect(page.getByRole("button", { name: presetQuestions[0].text, exact: true })).toBeEnabled();
}

// 帳號登入（#287）：登入頁的面板與帳號欄的選項（app/src/ui/sign-in.ts 的展示帳號＋角色名稱）
export const signInPanel = (page: Page) => page.locator("section.sign-in");
export function accountOption(id: RoleId): string {
  const role = access.roles.find((r) => r.id === id)!;
  return s.signInAccountOption.replace("{account}", demoAccount(id)).replace("{role}", role.label[language]);
}

// 手機（≤ 600px，#255）：頂端列的身分徽章，平板是導覽列底部的頭像，桌機是左側欄的使用者卡（#330）；都打開身分與語言面板。
// 登入頁沒有（登入頁的語言在桌機是左側欄的下拉選單）
export const identityBadge = (page: Page) => page.locator(":is(.mobile-topbar, .nav-rail, .sidebar) .identity-badge");
// 桌機左側欄的使用者卡（#330）
export const userCard = (page: Page) => page.locator(".sidebar .user-card");
// 以 class 找面板：切換語言後面板的名稱也會換成新的語言
export const identitySheet = (page: Page) => page.locator("dialog.identity-sheet");

// 在身分與語言面板中操作，完成後按 Esc 等面板收起
async function inIdentitySheet(page: Page, act: (sheet: Locator) => Promise<unknown>): Promise<void> {
  await identityBadge(page).click();
  const sheet = identitySheet(page);
  await expect(sheet).toBeVisible();
  await act(sheet);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
}

// 展示模式的頂端列（#260）：身分是分段切換（radiogroup），每個身分是一個 radio；不論寬度都取代手機的頂端列
export const identitySegments = (page: Page) => page.getByRole("banner").getByRole("radiogroup", { name: s.identity });

// 身分與語言面板裡的身分單選卡與語言的分段切換（#255 PR 2）。語言按鈕以 lang 屬性找，不看語言名稱的寫法
export const roleCard = (sheet: Locator, id: RoleId) =>
  sheet.getByRole("radio", { name: access.roles.find((r) => r.id === id)!.label[language], exact: true });
// 單選卡的整張卡（label.role-card，觸控目標）。filter({ has }) 的內層 locator 是相對於外層元素查詢，
// 所以內層從 page 開始寫，不能沿用從 sheet 開始的 roleCard()（否則會在卡片裡找面板，永遠找不到）
export const roleCardTarget = (sheet: Locator, id: RoleId) =>
  sheet.locator(".role-card").filter({
    has: sheet.page().getByRole("radio", { name: access.roles.find((r) => r.id === id)!.label[language], exact: true }),
  });
export const languageOption = (sheet: Locator, code: string) => sheet.getByRole("group", { name: s.language }).locator(`button[lang="${code}"]`);

// 切換身分：展示模式是頂端列的身分分段切換，其他是從身分徽章（桌機是使用者卡）打開的面板選身分的單選卡
export async function switchIdentity(page: Page, id: RoleId): Promise<void> {
  const role = access.roles.find((r) => r.id === id)!;
  const segments = identitySegments(page);
  if ((await segments.count()) > 0) {
    await segments.getByRole("radio", { name: role.label[language], exact: true }).check();
    return;
  }
  await inIdentitySheet(page, (sheet) => roleCard(sheet, id).check());
}

// 切換介面語言（code 是語言代碼）：身分與語言面板的分段切換；登入頁（沒有身分徽章）是左側欄的下拉選單
export async function switchLanguage(page: Page, code: string): Promise<void> {
  if (await identityBadge(page).isVisible()) await inIdentitySheet(page, (sheet) => languageOption(sheet, code).click());
  else await page.getByRole("banner").getByLabel(s.language).selectOption(code);
}

// 切到某一頁（以 data-view 找，不看介面語言）：左側欄、手機的分頁列，或手機上收在「更多」裡的頁面；這個身分沒有這一頁時回傳 false
export async function gotoView(page: Page, view: string): Promise<boolean> {
  const button = page.locator(`:is(.primary-tabs, .mobile-tabbar, .nav-rail) [data-view="${view}"]`);
  if ((await button.count()) > 0) {
    await button.click();
    return true;
  }
  const more = page.locator('.mobile-tabbar [data-view="more"]');
  if ((await more.count()) === 0) return false;
  await more.click();
  const item = page.locator(`.more-list [data-view="${view}"]`);
  if ((await item.count()) === 0) {
    await page.keyboard.press("Escape");
    return false;
  }
  await item.click();
  return true;
}

// 以 label 開頭比對的正規表示式
const startsWith = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

// 頁籤的按鈕；待審頁籤的名稱後面接著筆數，所以比對開頭
export function tab(page: Page, label: string): Locator {
  return page.getByRole("navigation", { name: s.views }).getByRole("button", { name: startsWith(label) });
}

// 包在 <label> 裡的欄位：無障礙名稱含有欄位目前的值（例如下拉選單選中的項目），所以以 label 文字的開頭找
const field = (page: Page, label: string, tag: "input" | "select") => page.locator("label").filter({ hasText: startsWith(label) }).locator(tag);

// 切換頁籤
export async function openTab(page: Page, label: string): Promise<void> {
  await tab(page, label).click();
}

export const sourcePanel = (page: Page) => page.getByRole("complementary", { name: s.sourceTitle });

// 以目前的身分上傳 fixtures 的檔案（預設 upload-note.md），萃取在背景執行（目前的身分要能上傳）。
// title：文件標題（沒有時用檔名）；visibility：可見等級的 id（沒有時用上傳頁的預設）
export async function upload(page: Page, options: { file?: string; title?: string; visibility?: string } = {}): Promise<void> {
  const { file = "upload-note.md", title, visibility } = options;
  await openTab(page, s.tabUpload);
  await page.getByLabel(s.uploadFile).setInputFiles(`e2e/fixtures/${file}`);
  if (title !== undefined) await field(page, s.uploadDocTitle, "input").fill(title);
  if (visibility !== undefined) {
    const level = access.visibilityLevels.find((l) => l.id === visibility)!;
    await field(page, s.uploadVisibility, "select").selectOption({ label: level.label[language] });
  }
  await page.getByRole("button", { name: s.uploadPreview }).click();

  const dialog = page.getByRole("dialog", { name: s.uploadConfirmTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: s.uploadSubmit, exact: true }).click();
  await expect(dialog.getByText(s.uploadDone)).toBeVisible();
  await dialog.getByRole("button", { name: s.uploadAnother }).click();
  await expect(dialog).toBeHidden();
}

// 等萃取的實體出現在待審（目前的身分要能審查）；expected：待審頁中要出現的實體名稱
export async function waitForReview(page: Page, expected = FAKE_ENTITY_NAME): Promise<void> {
  // 萃取在背景執行；結束前打開待審頁時看不到，按重新整理再讀一次
  await openTab(page, s.tabReview);
  const item = page.locator(".review-page").getByText(expected, { exact: true }).first();
  await expect(async () => {
    await page.getByRole("button", { name: s.reviewRefresh }).first().click();
    await expect(item).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

// 上傳並等萃取的實體出現在待審（目前的身分要能上傳也能審查）
export async function uploadAndReview(
  page: Page,
  options: { file?: string; title?: string; visibility?: string; expected?: string } = {},
): Promise<void> {
  await upload(page, options);
  await waitForReview(page, options.expected);
}
